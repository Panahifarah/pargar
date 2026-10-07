package api

import (
	"net/http"
	"testing"
)

func TestRouteLabelRedactsSecrets(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/api/exports/chats/abcSecretTokenXYZ", "/api/exports/chats/{token}"},
		{"/api/auth/register-invite/invitetokensecret", "/api/auth/register-invite/{token}"},
		{"/api/admin/users/42", "/api/admin/users/{id}"},
		{"/api/lessons/7/heartbeat", "/api/lessons/{id}/heartbeat"},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest("GET", tc.path, nil)
		got := routeLabel(req)
		if got != tc.want {
			t.Fatalf("path %s: got %q want %q", tc.path, got, tc.want)
		}
	}
}
