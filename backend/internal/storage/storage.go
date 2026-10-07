package storage

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Storage abstracts media file persistence.
type Storage interface {
	Save(key string, file multipart.File, size int64) (string, error)
	// Put writes raw bytes (used for seed / sample media).
	Put(key string, r io.Reader, size int64) (string, error)
	Open(key string) (io.ReadCloser, time.Time, string, error)
	// Exists reports whether key is present.
	Exists(key string) bool
	// Serve streams a key with HTTP Range support when possible.
	Serve(w http.ResponseWriter, r *http.Request, key string) error
	// URL returns the absolute serving URL for a key (or "" if none).
	URL(key string) string
}

// Local implements Storage using the local filesystem, served by the API at /media/.
type Local struct {
	dir     string
	baseURL string
}

func NewLocal(dir, publicURL string) *Local {
	return &Local{dir: dir, baseURL: publicURL}
}

// cleanLocalKey keeps nested keys like chats/1-x.png while blocking path traversal.
func cleanLocalKey(key string) (string, error) {
	key = strings.TrimSpace(strings.TrimPrefix(key, "/"))
	key = filepath.ToSlash(key)
	if key == "" || strings.Contains(key, "\\") || strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid key")
	}
	parts := strings.Split(key, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || filepath.Base(p) != p {
			return "", fmt.Errorf("invalid key")
		}
	}
	return key, nil
}

func (l *Local) Save(key string, file multipart.File, size int64) (string, error) {
	return l.Put(key, file, size)
}

func (l *Local) Put(key string, r io.Reader, size int64) (string, error) {
	clean, err := cleanLocalKey(key)
	if err != nil {
		return "", err
	}
	dst := filepath.Join(l.dir, filepath.FromSlash(clean))
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if size > 0 {
		if _, err := io.CopyN(out, r, size); err != nil && err != io.EOF {
			return "", err
		}
	} else {
		if _, err := io.Copy(out, r); err != nil {
			return "", err
		}
	}
	return l.URL(clean), nil
}

func (l *Local) Exists(key string) bool {
	clean, err := cleanLocalKey(key)
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(l.dir, filepath.FromSlash(clean)))
	return err == nil
}

func (l *Local) Open(key string) (io.ReadCloser, time.Time, string, error) {
	clean, err := cleanLocalKey(key)
	if err != nil {
		return nil, time.Time{}, "", err
	}
	f, err := os.Open(filepath.Join(l.dir, filepath.FromSlash(clean)))
	if err != nil {
		return nil, time.Time{}, "", err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, time.Time{}, "", err
	}
	return f, info.ModTime(), mimeType(clean), nil
}

func (l *Local) Serve(w http.ResponseWriter, r *http.Request, key string) error {
	clean, err := cleanLocalKey(key)
	if err != nil {
		return err
	}
	path := filepath.Join(l.dir, filepath.FromSlash(clean))
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	setInlineMediaHeaders(w, mimeType(clean))
	// Empty name avoids Content-Disposition attachment hints from some clients.
	http.ServeContent(w, r, "", info.ModTime(), f)
	return nil
}

func (l *Local) URL(key string) string {
	if key == "" {
		return ""
	}
	clean, err := cleanLocalKey(key)
	if err != nil {
		return ""
	}
	return l.baseURL + "/media/" + clean
}

func (l *Local) Dir() string { return l.dir }

type S3 struct {
	client  *s3.Client
	bucket  string
	baseURL string
}

func NewS3(ctx context.Context, endpoint, region, accessKey, secretKey, bucket, publicURL string) (*S3, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(endpoint)
		options.UsePathStyle = true
	})
	storage := &S3{client: client, bucket: bucket, baseURL: strings.TrimRight(publicURL, "/")}
	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)}); err != nil {
		if _, createErr := client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); createErr != nil {
			return nil, createErr
		}
	}
	return storage, nil
}

func (s *S3) Save(key string, file multipart.File, size int64) (string, error) {
	return s.Put(key, file, size)
}

func (s *S3) Put(key string, r io.Reader, size int64) (string, error) {
	objectKey := cleanKey(key)
	if objectKey == "" {
		return "", fmt.Errorf("invalid key")
	}
	input := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
		Body:   r,
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	_, err := s.client.PutObject(context.Background(), input)
	if err != nil {
		return "", err
	}
	return s.URL(key), nil
}

func (s *S3) Exists(key string) bool {
	objectKey := cleanKey(key)
	if objectKey == "" {
		return false
	}
	_, err := s.client.HeadObject(context.Background(), &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	})
	return err == nil
}

func (s *S3) Open(key string) (io.ReadCloser, time.Time, string, error) {
	objectKey := cleanKey(key)
	if objectKey == "" {
		return nil, time.Time{}, "", fmt.Errorf("invalid key")
	}
	result, err := s.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		return nil, time.Time{}, "", err
	}
	return result.Body, time.Time{}, mimeType(key), nil
}

func (s *S3) Serve(w http.ResponseWriter, r *http.Request, key string) error {
	objectKey := cleanKey(key)
	if objectKey == "" {
		return fmt.Errorf("invalid key")
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(objectKey),
	}
	if rng := r.Header.Get("Range"); rng != "" {
		input.Range = aws.String(rng)
	}
	result, err := s.client.GetObject(r.Context(), input)
	if err != nil {
		return err
	}
	defer result.Body.Close()

	ct := mimeType(key)
	if result.ContentType != nil && *result.ContentType != "" {
		ct = *result.ContentType
	}
	w.Header().Set("Content-Type", ct)
	setInlineMediaHeaders(w, ct)
	w.Header().Set("Accept-Ranges", "bytes")
	if result.ContentLength != nil {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", *result.ContentLength))
	}
	if result.ContentRange != nil {
		w.Header().Set("Content-Range", *result.ContentRange)
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	_, err = io.Copy(w, result.Body)
	return err
}

func (s *S3) URL(key string) string {
	return s.baseURL + "/media/" + cleanKey(key)
}

func cleanKey(key string) string {
	clean := filepath.ToSlash(filepath.Clean(key))
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || clean == "." || strings.Contains(clean, "..") {
		return ""
	}
	return clean
}

func mimeType(key string) string {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

// setInlineMediaHeaders discourages "Save as" download UX while keeping streaming/Range intact.
func setInlineMediaHeaders(w http.ResponseWriter, contentType string) {
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
}
