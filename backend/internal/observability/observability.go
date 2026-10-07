package observability

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// Config holds optional OpenTelemetry settings.
type Config struct {
	ServiceName  string
	OTLPEndpoint string // empty = noop tracer
}

var (
	logger *slog.Logger
	tracer trace.Tracer = noop.NewTracerProvider().Tracer("pargar")
)

// SetupJSONLogger installs a JSON slog default logger.
func SetupJSONLogger() *slog.Logger {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger = slog.New(handler)
	slog.SetDefault(logger)
	return logger
}

func L() *slog.Logger {
	if logger == nil {
		return slog.Default()
	}
	return logger
}

// Activity emits a structured domain activity log line.
func Activity(action string, attrs ...any) {
	args := make([]any, 0, len(attrs)+2)
	args = append(args, "action", action)
	args = append(args, attrs...)
	L().Info("activity", args...)
}

// SetupTracing configures OTLP HTTP exporter when endpoint is set; otherwise noop.
// Returns a shutdown func (always non-nil).
func SetupTracing(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	name := strings.TrimSpace(cfg.ServiceName)
	if name == "" {
		name = "pargar-api"
	}
	endpoint := strings.TrimSpace(cfg.OTLPEndpoint)
	if endpoint == "" {
		tp := noop.NewTracerProvider()
		otel.SetTracerProvider(tp)
		tracer = tp.Tracer(name)
		L().Info("otel tracing disabled (no OTEL_EXPORTER_OTLP_ENDPOINT)")
		return func(context.Context) error { return nil }, nil
	}

	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	exp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(name),
		),
	)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	tracer = tp.Tracer(name)
	L().Info("otel tracing enabled", "endpoint", endpoint, "service", name)
	return tp.Shutdown, nil
}

func Tracer() trace.Tracer { return tracer }

// StartSpan starts a named span from context.
func StartSpan(ctx context.Context, name string) (context.Context, trace.Span) {
	return Tracer().Start(ctx, name)
}

// DurationMs helper for middleware logs.
func DurationMs(start time.Time) int64 {
	return time.Since(start).Milliseconds()
}
