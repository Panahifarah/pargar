package storage

import "testing"

func TestVoiceNoteContentType(t *testing.T) {
	if got := mimeType("chats/2-1.weba"); got != "audio/webm" {
		t.Fatalf("weba: %s", got)
	}
	if got := mediaContentType("chats/2-1.weba", "application/octet-stream"); got != "audio/webm" {
		t.Fatalf("generic store type must not hide the voice type: %s", got)
	}
	if got := mediaContentType("chats/2-1.bin", "application/pdf"); got != "application/pdf" {
		t.Fatalf("unknown extension keeps the stored type: %s", got)
	}
}
