package storage

import (
	"fmt"
	"os"
	"path/filepath"
)

const SampleVideoKey = "sample.mp4"

// EnsureSampleMP4 uploads the color-bars sample video when the storage key is missing.
// candidates are filesystem paths checked in order (first readable wins).
func EnsureSampleMP4(stg Storage, candidates ...string) error {
	if stg == nil {
		return fmt.Errorf("storage is nil")
	}
	if stg.Exists(SampleVideoKey) {
		return nil
	}
	for _, path := range candidates {
		if path == "" {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			continue
		}
		if info.IsDir() || info.Size() == 0 {
			f.Close()
			continue
		}
		_, err = stg.Put(SampleVideoKey, f, info.Size())
		f.Close()
		if err != nil {
			return fmt.Errorf("upload %s: %w", SampleVideoKey, err)
		}
		return nil
	}
	return fmt.Errorf("%s missing in storage and no readable candidate found among %v", SampleVideoKey, candidates)
}

// DefaultSampleCandidates returns common relative locations for the checked-in sample.
func DefaultSampleCandidates() []string {
	cwd, _ := os.Getwd()
	return []string{
		filepath.Join(cwd, "media", SampleVideoKey),
		filepath.Join(cwd, "backend", "media", SampleVideoKey),
		filepath.Join("media", SampleVideoKey),
		filepath.Join("backend", "media", SampleVideoKey),
	}
}
