package observability

import "testing"

func TestSetupTracingNoop(t *testing.T) {
	shutdown, err := SetupTracing(t.Context(), Config{ServiceName: "test", OTLPEndpoint: ""})
	if err != nil {
		t.Fatal(err)
	}
	if shutdown == nil {
		t.Fatal("expected shutdown func")
	}
	if err := shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	ctx, span := StartSpan(t.Context(), "test.span")
	_ = ctx
	span.End()
}
