package observability

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Lightweight in-process Prometheus text metrics (no promhttp / compress deps).

type counterVec struct {
	mu     sync.Mutex
	name   string
	help   string
	labels []string
	values map[string]*atomic.Int64
}

func newCounterVec(name, help string, labels []string) *counterVec {
	return &counterVec{
		name:   name,
		help:   help,
		labels: labels,
		values: map[string]*atomic.Int64{},
	}
}

func (c *counterVec) WithLabelValues(vals ...string) *atomic.Int64 {
	key := strings.Join(vals, "\x00")
	c.mu.Lock()
	defer c.mu.Unlock()
	if v, ok := c.values[key]; ok {
		return v
	}
	v := &atomic.Int64{}
	c.values[key] = v
	return v
}

func (c *counterVec) Inc(vals ...string) {
	c.WithLabelValues(vals...).Add(1)
}

func (c *counterVec) write(b *strings.Builder) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s counter\n", c.name, c.help, c.name)
	keys := make([]string, 0, len(c.values))
	for k := range c.values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		parts := strings.Split(k, "\x00")
		var labelPairs []string
		for i, lab := range c.labels {
			val := ""
			if i < len(parts) {
				val = parts[i]
			}
			labelPairs = append(labelPairs, fmt.Sprintf(`%s="%s"`, lab, escapeLabel(val)))
		}
		fmt.Fprintf(b, "%s{%s} %d\n", c.name, strings.Join(labelPairs, ","), c.values[k].Load())
	}
}

type counter struct {
	name  string
	help  string
	value atomic.Int64
}

func newCounter(name, help string) *counter {
	return &counter{name: name, help: help}
}

func (c *counter) Inc() { c.value.Add(1) }

func (c *counter) write(b *strings.Builder) {
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s counter\n%s %d\n", c.name, c.help, c.name, c.name, c.value.Load())
}

type histVec struct {
	mu      sync.Mutex
	name    string
	help    string
	buckets []float64
	obs     map[string]*histObs
}

type histObs struct {
	counts []atomic.Uint64
	sum    atomic.Uint64 // milliseconds * 1000 for precision via float bits — use float64 via mutex instead
	sumMu  sync.Mutex
	sumF   float64
	count  atomic.Uint64
}

func newHistVec(name, help string, buckets []float64) *histVec {
	return &histVec{
		name:    name,
		help:    help,
		buckets: buckets,
		obs:     map[string]*histObs{},
	}
}

func (h *histVec) Observe(method, path string, seconds float64) {
	key := method + "\x00" + path
	h.mu.Lock()
	o, ok := h.obs[key]
	if !ok {
		o = &histObs{counts: make([]atomic.Uint64, len(h.buckets))}
		h.obs[key] = o
	}
	h.mu.Unlock()
	for i, b := range h.buckets {
		if seconds <= b {
			o.counts[i].Add(1)
		}
	}
	o.count.Add(1)
	o.sumMu.Lock()
	o.sumF += seconds
	o.sumMu.Unlock()
}

func (h *histVec) write(b *strings.Builder) {
	h.mu.Lock()
	defer h.mu.Unlock()
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s histogram\n", h.name, h.help, h.name)
	keys := make([]string, 0, len(h.obs))
	for k := range h.obs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		parts := strings.Split(k, "\x00")
		method, path := parts[0], ""
		if len(parts) > 1 {
			path = parts[1]
		}
		base := fmt.Sprintf(`method="%s",path="%s"`, escapeLabel(method), escapeLabel(path))
		o := h.obs[k]
		for i, bound := range h.buckets {
			fmt.Fprintf(b, `%s_bucket{%s,le="%g"} %d`+"\n", h.name, base, bound, o.counts[i].Load())
		}
		fmt.Fprintf(b, `%s_bucket{%s,le="+Inf"} %d`+"\n", h.name, base, o.count.Load())
		o.sumMu.Lock()
		sum := o.sumF
		o.sumMu.Unlock()
		fmt.Fprintf(b, "%s_sum{%s} %g\n", h.name, base, sum)
		fmt.Fprintf(b, "%s_count{%s} %d\n", h.name, base, o.count.Load())
	}
}

func escapeLabel(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

var (
	httpRequests = newCounterVec("pargar_http_requests_total", "Total HTTP requests", []string{"method", "path", "status"})
	httpDuration = newHistVec("pargar_http_request_duration_seconds", "HTTP request duration", []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10})
	quizSubmits  = newCounterVec("pargar_quiz_submits_total", "Quiz submit outcomes", []string{"result"})
	lockouts     = newCounter("pargar_account_lockouts_total", "Accounts locked after heart depletion")
	heartbeats   = newCounter("pargar_watch_heartbeats_total", "Accepted watch heartbeats")
	videoUploads = newCounter("pargar_video_uploads_total", "Admin video uploads")
	logins       = newCounterVec("pargar_auth_logins_total", "Login attempts", []string{"result"})
)

// Compatibility wrappers matching previous call sites.

type labeledInc struct{ vec *counterVec }

func (l labeledInc) WithLabelValues(vals ...string) interface{ Inc() } {
	return labeledCounter{c: l.vec.WithLabelValues(vals...)}
}

type labeledCounter struct{ c *atomic.Int64 }

func (l labeledCounter) Inc() { l.c.Add(1) }

var (
	HTTPRequests = labeledInc{httpRequests}
	QuizSubmits  = labeledInc{quizSubmits}
	Logins       = labeledInc{logins}
	Lockouts     = lockouts
	Heartbeats   = heartbeats
	VideoUploads = videoUploads
)

// ObserveHTTP records request metrics.
func ObserveHTTP(method, path string, status int, d time.Duration) {
	httpRequests.Inc(method, path, fmt.Sprintf("%d", status))
	httpDuration.Observe(method, path, d.Seconds())
}

// MetricsHandler serves Prometheus text exposition.
func MetricsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b strings.Builder
		httpRequests.write(&b)
		httpDuration.write(&b)
		quizSubmits.write(&b)
		lockouts.write(&b)
		heartbeats.write(&b)
		videoUploads.write(&b)
		logins.write(&b)
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = w.Write([]byte(b.String()))
	})
}
