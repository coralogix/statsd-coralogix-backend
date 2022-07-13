# statsd-coralogix-backend

A plugin to connect StatsD to [Coralogix]

## Configuration

```js
module.export: {
    // You can get it from coralogix UI at `/#/settings/send-your-data`
    privateKey: "****FILL_ME_IN****",
    apiHost: "https://prometheus-gateway.coralogix.com:9090/prometheus/api/v1/write",
    // Your metrics will be prefixed by this prefix
    prefix: "test_prefix",
    // Coralogix specific label that will be added to all metrics
    applicationName: "test_application",
    // Coralogix specific label that will be added to all metrics
    subsystemName: "test_subsystem",
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
echo "timer_test:65|ms|#tag_1:value,tag_2:value_2" | /usr/bin/nc -u -w0 127.0.0.1 812
```

## How to install the backend

```bash
cd /path/to/statsd-dir
npm install statsd-coralogix-backend
```

### How to enable the backend
Add `statsd-coralogix-backend` to your list of StatsD backends:

```js
backends: ["statsd-coralogix-backend"]
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
  backends: ["statsd-coralogix-backend"],
  coralogix: {
    privateKey: "****FILL_ME_IN****",
    apiHost: "https://prometheus-gateway.coralogix.com:9090/prometheus/api/v1/write",
    prefix: "test_prefix",
    applicationName: "test_application",
    subsystemName: "test_subsystem",
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