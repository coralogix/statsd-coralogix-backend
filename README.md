# statsd-coralogix-backend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@coralogix/statsd-backend.svg)](https://www.npmjs.com/package/@coralogix/statsd-backend)
[![node](https://img.shields.io/node/v/@coralogix/statsd-backend.svg)](https://www.npmjs.com/package/@coralogix/statsd-backend)
-----

A plugin to connect StatsD to [Coralogix].

Coralogix documentation can be found [here](https://coralogix.com/docs/statsd/).

## Breaking change notice

* In version `0.1.*` we were calculating `_total` for counters as rate per sedonds. This was fixed in `0.2.0` where we
  added internal acumulator for `_total` of counters and we do report the metric correctly.

## Configuration

```js
module.export: {
    // You can get it from coralogix UI at `/#/settings/send-your-data`
    privateKey: "****FILL_ME_IN****",
    apiHost: "https://ingress.coralogix.com/prometheus/v1",
    // Your metrics will be prefixed by this prefix
    prefix: "test_prefix",
    // Coralogix specific label that will be added to all metrics
    applicationName: "test_application",
    // Coralogix specific label that will be added to all metrics
    subsystemName: "test_subsystem",
    // For controlling number of seconds for which we accumulate counter totals before droping them,
    //   this is here to not leak memory with infinite number of metrics kept there. Defaults to 3600.
    // Generally it should be lot higher than you flush_interval.
    totalsAccumulatorTtlSeconds: 3600,
    // Mappings used to define histogram buckets and whatnot
    mappings: {
      timer_test: {
        histogram_options: { buckets: [50, 100, 250, 500, 1000] },
        // Any additional labels for specific metric
        labels: { job: 'test_job' }
      },
      timer_test_2: {
        histogram_options: { buckets: [50, 100, 250, 500, 1000] }
      }
    }
  }
```

## Additional labels on metrics without config

This would end up adding labels
* with name `tag_1`and value `value_1`
* with name `tag_2`and value `value_2`

```bash
echo "timer_test:65|ms|#tag_1:value,tag_2:value_2" | /usr/bin/nc -u -w0 127.0.0.1 8125
```

## How to install the backend

```bash
cd /path/to/statsd-dir
npm install @coralogix/statsd-backend
```

### How to enable the backend
Add `statsd-coralogix-backend` to your list of StatsD backends:

```js
backends: ["@coralogix/statsd-backend"]
```

[Coralogix]: https://coralogix.com/

### Full config example

```js
module.exports = {
  deleteIdleStats: true,
  deleteGauges: true,
  deleteTimers: true,
  deleteCounters: true,
  port: 8125,
  backends: ["@coralogix/statsd-backend"],
  coralogix: {
    privateKey: "****FILL_ME_IN****",
    apiHost: "https://ingress.coralogix.com/prometheus/v1",
    prefix: "test_prefix",
    applicationName: "test_application",
    subsystemName: "test_subsystem",
    totalsAccumulatorTtlSeconds: 3600,
    mappings: {
      timer_test: {
        histogram_options: { buckets: [50, 100, 250, 500, 1000] },
        labels: { job: 'test_job' }
      },
      timer_test_2: {
        histogram_options: { buckets: [50, 100, 250, 500, 1000] }
      }
    }
  }
}
```
