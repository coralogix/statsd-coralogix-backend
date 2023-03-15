/*
 * Flush stats to Coralogix (https://coralogix.com).
 *
 * To enable this backend, include 'statsd-coralogix-backend' in the backends
 * configuration array:
 *
 *   backends: ['statsd-coralogix-backend']
 *
 * This backend supports the following config options:
 *  privateKey: "****FILL_ME_IN****",
 *  apiHost: "https://prometheus-gateway.coralogix.com:9090/prometheus/api/v1/write",
 *  prefix: "test_prefix",
 *  applicationName: "test_application",
 *  subsystemName: "test_subsystem",
 *  // For controlling number of seconds for which we accumulate counter totals before droping them,
 *  //   this is here to not leak memory with infinite number of metrics kept there. Defaults to 3600.
 *  totalsAccumulatorTtlSeconds: 3600,
 *  mappings: {
 *    metric_name: {
 *      histogram_options: { buckets: [50, 100, 250, 500, 1000] },
 *      labels: { job: 'test_job' }
 *    }
 *  }
 *
 */
const snappy = require('snappy');
const protobuf = require("protobufjs");
const axios = require('axios');
const os = require('os');
const TIMEOUT = 10000;

let logger;
let debug;
let flushInterval;
let hostname;
let coralogixApiHost;
let coralogixPrivateKey;
let coralogixStats = {};
let coralogixPrefix;
let coralogixMappings = [];
let coralogixConfig = {};
let totalsAccumulator = new Map()
let ttlSeconds;

const Coralogix = function (api_key, options) {
    options = options || {};
    this.api_key = api_key;
    this.api_host = options.api_host;
    this.host_name = options.host_name || os.hostname();
    this.pending_requests = 0;
};

function make_labels(labels, host, name) {
    const labels_list = [];

    labels_list.push({name: '__name__', value: name});
    labels_list.push({name: '__meta_applicationname', value: coralogixConfig.applicationName});
    labels_list.push({name: '__meta_subsystem', value: coralogixConfig.subsystemName});
    labels_list.push({name: 'host', value: host});
    if (labels)
        Object.entries(labels).forEach(([key, value]) => {
            labels_list.push({name: key, value: value});
        });

    return labels_list;
}

Coralogix.prototype.metrics = function (payload) {
    const client = this;
    protobuf.load([__dirname + "/protos/remote.proto", __dirname + "/protos/types.proto"]).then(function (root) {
        try {
            var WriteRequest = root.lookupType("prometheus.WriteRequest");
            var msg_payload = {timeseries: payload, metadata: []};
            var errMsg = WriteRequest.verify(msg_payload);
            if (errMsg) {
                console.log("Protobuf validation failed with: ", errMsg);
                throw Error(errMsg);
            }

            var message = WriteRequest.fromObject(msg_payload);
            const write_request = WriteRequest.encode(message).finish();
            client._post('series', snappy.compressSync(write_request));
        } catch (error) {
            if (error) {
                logger.log('Skipping, cannot send maldofmed data to Coralogix: ' + error.message);
            }
        }
    });
};

Coralogix.prototype._post = function (controller, write_request) {
    try {
        axios({
            method: "POST",
            url: coralogixApiHost,
            timeout: TIMEOUT,
            data: write_request,
            headers: {
                'Content-Length': write_request.length,
                'Authorization': 'Bearer ' + coralogixPrivateKey
            },
        }).catch(function (error) {
            console.log(error);
        })
            // always executed
            .then(function () {
            });

    } catch (error) {
        if (error) {
            logger.log('Skipping, cannot send data to Coralogix: ' + error.message);
        }
    }
};

function coralogix_tags_to_labels(tags) {
    const res = [];
    tags.forEach(tag => {
        const [key, value] = tag.split('=');
        res.push({
            name: key,
            value: value || 'single'
        });
    });
    return res;
}

const post_stats = function coralogix_post_stats(payload) {
    try {
        new Coralogix(coralogixPrivateKey, {api_host: coralogixApiHost}).metrics(payload);
        coralogixStats.last_flush = Math.round(new Date().getTime() / 1000);
    } catch (e) {
        if (debug) {
            logger.log(e);
        }
        coralogixStats.last_exception = Math.round(new Date().getTime() / 1000);
    }
};

const flush_stats = function coralogix_post_stats(ts, metrics) {
    const timestamp = ts * 1000;

    const counters = metrics.counters;
    const gauges = metrics.gauges;
    const timers = metrics.timers;
    const timer_data = metrics.timer_data;
    const sets = metrics.sets;
    const pctThreshold = metrics.pctThreshold;

    const host = hostname || os.hostname();
    const payload = [];

    let value;
    let mapping;

    const tsLiveUntil = ts + ttlSeconds;
    // Transform counters
    for (full_key in counters) {
        const [key, ...tags] = full_key.split(';');
        const sorted_tags = tags.sort();
        const labels_from_tags = coralogix_tags_to_labels(sorted_tags);
        mapping = coralogixMappings.get(key);
        value = counters[full_key];

        const accKey = key + sorted_tags.join(';');
        const [oldTotal,_] = totalsAccumulator.get(accKey) ?? [0,0];
        const newTotal = oldTotal + value;
        totalsAccumulator.set(accKey, [newTotal,tsLiveUntil])

        payload.push({
            labels: make_labels(mapping?.labels, host, get_prefix(key) + '_total').concat(labels_from_tags),
            samples: [{timestamp: timestamp, value: newTotal}],
        });
    }

    // Transform gauges
    for (full_key in gauges) {
        const [key, ...tags] = full_key.split(';');
        const labels_from_tags = coralogix_tags_to_labels(tags);
        mapping = coralogixMappings.get(key);
        value = gauges[full_key];

        payload.push({
            labels: make_labels(mapping?.labels, host, get_prefix(key)).concat(labels_from_tags),
            samples: [{timestamp: timestamp, value: value}],
        });
    }

    // Transform sets
    for (full_key in sets) {
        const [key, ...tags] = full_key.split(';');
        const labels_from_tags = coralogix_tags_to_labels(tags);
        mapping = coralogixMappings.get(key);
        payload.push({
            labels: make_labels(mapping?.labels, host, get_prefix(key)).concat(labels_from_tags),
            samples: [{timestamp: timestamp, value: 1}],
        });
    }


    // Transform timers
    for (full_key in timers) {
        const [key, ...tags] = full_key.split(';');
        const labels_from_tags = coralogix_tags_to_labels(tags);
        if (timers[full_key].length > 0) {
            mapping = coralogixMappings.get(key);
            const values = timers[full_key].sort(function (a, b) {
                return a - b;
            });
            const data = timer_data[full_key];
            const count = data.count;
            const sum = data.sum;
            let i;

            if (count > 1) {
                const thresholdIndex = Math.round(((100 - pctThreshold) / 100) * count);
                const numInThreshold = count - thresholdIndex;
                const pctValues = values.slice(0, numInThreshold);
                maxAtThreshold = pctValues[numInThreshold - 1];

                // average the remaining timings
                let sum = 0;
                for (i = 0; i < numInThreshold; i++) {
                    sum += pctValues[i];
                }

                mean = sum / numInThreshold;
            }

            payload.push({
                labels: make_labels(mapping?.labels, host, get_prefix(key + '_sum')).concat(labels_from_tags),
                samples: [{timestamp: timestamp, value: sum}],
            });

            payload.push({
                labels: make_labels(mapping?.labels, host, get_prefix(key + '_count')).concat(labels_from_tags),
                samples: [{timestamp: timestamp, value: count}],
            });


            const buckets = mapping?.histogram_options?.buckets;
            if (buckets) {
                const bucket_key = get_prefix(key) + '_bucket';
                for (bucket in buckets) {
                    const bucket_count = values.filter(function (v) {
                        return v <= buckets[bucket];
                    }).length;
                    const labels = make_labels(mapping?.labels, host, bucket_key).concat(labels_from_tags);
                    labels.push({name: 'le', value: String(buckets[bucket])});
                    payload.push({
                        labels: labels,
                        samples: [{timestamp: timestamp, value: bucket_count}],
                    });
                }

                const labels = make_labels(mapping?.labels, host, bucket_key).concat(labels_from_tags);
                labels.push({name: 'le', value: '+Inf'});
                payload.push({
                    labels: labels,
                    samples: [{timestamp: timestamp, value: count}],
                });

            }

            // TODO support for quantiles
        }
    }

    post_stats(payload);
    pruneTotalsAccumulator(ts);
};

function pruneTotalsAccumulator(currentTs){
    totalsAccumulator.forEach( (value, key, _map) => {
        let [_value,tsLiveUntil] = value;
        if (currentTs >= tsLiveUntil){
            totalsAccumulator.delete(key);
        }
    });
}

const get_prefix = function coralogix_get_prefix(key) {
    if (coralogixPrefix !== undefined) {
        return [coralogixPrefix, key].join('_').replace(/\./g, '_');
    } else {
        return key;
    }
}

const backend_status = function coralogix_status(writeCb) {
    let stat;

    for (stat in coralogixStats) {
        writeCb(null, 'coralogix', stat, coralogixStats[stat]);
    }
};

exports.init = function coralogix_init(startup_time, config, events, log) {
    logger = log;
    debug = config.debug;
    hostname = config.hostname;

    coralogixConfig = config.coralogix;
    coralogixPrivateKey = coralogixConfig.privateKey;
    coralogixApiHost = coralogixConfig.apiHost;
    coralogixPrefix = coralogixConfig.prefix;
    coralogixMappings = new Map(Object.entries(coralogixConfig.mappings));
    ttlSeconds = coralogixConfig.totalsAccumulatorTtlSeconds ?? 3600;

    coralogixStats.last_flush = startup_time;
    coralogixStats.last_exception = startup_time;


    events.on('flush', flush_stats);
    events.on('status', backend_status);

    return true;
};
