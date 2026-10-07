package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port                   string
	DatabaseURL            string
	RedisURL               string
	JWTSecret              string
	PublicURL              string
	FrontendOrigins        []string
	TrustedProxyCIDRs      []*net.IPNet
	MetricsToken           string
	StorageDriver          string
	StorageDir             string
	StorageEndpoint        string
	StorageRegion          string
	StorageAccess          string
	StorageSecret          string
	StorageBucket          string
	HeartRegenHours        int
	AccessTokenTTL         time.Duration
	RefreshTokenTTL        time.Duration // remember-me / long-lived refresh
	RefreshTokenTTLSession time.Duration // short-lived refresh when rememberMe is false
	MediaURLTTL            time.Duration
	DevMode                bool
	// CaptchaExposeAnswer returns plaintext captcha answers in GET /api/auth/captcha.
	// Must never be enabled outside local tests (requires DevMode as well).
	CaptchaExposeAnswer    bool
	SeedCurriculum         bool
	OTELEndpoint           string
	OTELServiceName        string
	DonationEnabled        bool
	DonationNote           string
	PhysicalCertEnabled    bool
	PhysicalCertPriceIRR   int
	PhysicalCertWindowDays int
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// defaultTrustedProxyCIDRs covers loopback and typical Docker/private networks.
const defaultTrustedProxyCIDRs = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

func parseCIDRs(raw string) ([]*net.IPNet, error) {
	parts := strings.Split(raw, ",")
	out := make([]*net.IPNet, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		_, network, err := net.ParseCIDR(p)
		if err != nil {
			return nil, err
		}
		out = append(out, network)
	}
	return out, nil
}

func Load() *Config {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		jwtSecret = developmentSecret()
	}
	// Fail closed: production-safe default unless explicitly enabled.
	devMode := getEnv("DEV_MODE", "false") == "true"
	origins := parseOrigins(getEnv("FRONTEND_ORIGINS", ""))
	if len(origins) == 0 {
		origins = []string{
			"https://localhost", "https://127.0.0.1",
			"http://localhost:3000", "http://127.0.0.1:3000",
			"http://localhost:3001", "http://127.0.0.1:3001",
			"http://localhost", "http://127.0.0.1",
		}
	}
	seedCurriculum := getEnv("SEED_CURRICULUM", "") == "true"
	if getEnv("SEED_CURRICULUM", "") == "" && devMode {
		seedCurriculum = true
	}
	cidrs, err := parseCIDRs(getEnv("TRUSTED_PROXY_CIDRS", defaultTrustedProxyCIDRs))
	if err != nil {
		// Fall back to defaults rather than refusing to boot on a typo in optional env.
		cidrs, _ = parseCIDRs(defaultTrustedProxyCIDRs)
	}
	return &Config{
		Port:                   getEnv("PORT", "8080"),
		DatabaseURL:            resolveDatabaseURL(),
		RedisURL:               resolveRedisURL(),
		JWTSecret:              jwtSecret,
		PublicURL:              strings.TrimRight(getEnv("PUBLIC_URL", "https://localhost"), "/"),
		FrontendOrigins:        origins,
		TrustedProxyCIDRs:      cidrs,
		MetricsToken:           strings.TrimSpace(getEnv("METRICS_TOKEN", "")),
		StorageDriver:          getEnv("STORAGE_DRIVER", "s3"),
		StorageDir:             getEnv("STORAGE_DIR", "media"),
		StorageEndpoint:        getEnv("STORAGE_ENDPOINT", "http://rustfs:9000"),
		StorageRegion:          getEnv("STORAGE_REGION", "us-east-1"),
		StorageAccess:          getEnv("STORAGE_ACCESS_KEY", ""),
		StorageSecret:          getEnv("STORAGE_SECRET_KEY", ""),
		StorageBucket:          getEnv("STORAGE_BUCKET", "pargar"),
		HeartRegenHours:        getEnvInt("HEART_REGEN_HOURS", 4),
		AccessTokenTTL:         15 * time.Minute,
		RefreshTokenTTL:        30 * 24 * time.Hour,
		RefreshTokenTTLSession: 24 * time.Hour,
		MediaURLTTL:            2 * time.Hour,
		DevMode:                devMode,
		CaptchaExposeAnswer:    devMode && getEnv("CAPTCHA_EXPOSE_ANSWER", "") == "true",
		SeedCurriculum:         seedCurriculum,
		OTELEndpoint:           getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		OTELServiceName:        getEnv("OTEL_SERVICE_NAME", "pargar-api"),
		DonationEnabled:        getEnv("DONATION_ENABLED", "true") == "true",
		DonationNote:           getEnv("DONATION_NOTE", "اگر مایلید از مسیر حمایت کنید، وارد شوید و در گفتگو با تیم هماهنگ کنید — جزئیات فقط خصوصی رد و بدل می‌شود."),
		PhysicalCertEnabled:    getEnv("PHYSICAL_CERT_ENABLED", "false") == "true",
		PhysicalCertPriceIRR:   getEnvInt("PHYSICAL_CERT_PRICE_IRR", 2_500_000),
		PhysicalCertWindowDays: getEnvInt("PHYSICAL_CERT_WINDOW_DAYS", 30),
	}
}

// resolveDatabaseURL prefers DATABASE_URL; otherwise builds from POSTGRES_* with proper encoding.
func resolveDatabaseURL() string {
	if u := strings.TrimSpace(os.Getenv("DATABASE_URL")); u != "" {
		return u
	}
	pass := os.Getenv("POSTGRES_PASSWORD")
	host := getEnv("POSTGRES_HOST", "")
	if pass == "" || host == "" {
		return "postgres://pargar:local-dev-only-password@localhost:5432/pargar?sslmode=disable"
	}
	user := getEnv("POSTGRES_USER", "pargar")
	db := getEnv("POSTGRES_DB", "pargar")
	ssl := getEnv("POSTGRES_SSLMODE", "disable")
	port := getEnv("POSTGRES_PORT", "5432")
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, pass),
		Host:   net.JoinHostPort(host, port),
		Path:   "/" + db,
	}
	q := u.Query()
	q.Set("sslmode", ssl)
	u.RawQuery = q.Encode()
	return u.String()
}

// resolveRedisURL prefers REDIS_URL; otherwise builds from REDIS_HOST + REDIS_PASSWORD.
func resolveRedisURL() string {
	if u := strings.TrimSpace(os.Getenv("REDIS_URL")); u != "" {
		return u
	}
	host := getEnv("REDIS_HOST", "")
	if host == "" {
		return "redis://localhost:6379"
	}
	port := getEnv("REDIS_PORT", "6379")
	pass := os.Getenv("REDIS_PASSWORD")
	u := &url.URL{
		Scheme: "redis",
		Host:   net.JoinHostPort(host, port),
	}
	if pass != "" {
		u.User = url.UserPassword("", pass)
	}
	if db := strings.TrimSpace(os.Getenv("REDIS_DB")); db != "" {
		u.Path = "/" + db
	}
	return u.String()
}

func parseOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, strings.TrimRight(p, "/"))
		}
	}
	return out
}

var insecureSecretMarkers = []string{
	"change-me",
	"local-dev-only",
	"insecure-default",
	"password",
	"secret",
	"admin",
}

func isInsecureSecret(v string) bool {
	s := strings.ToLower(strings.TrimSpace(v))
	if s == "" {
		return true
	}
	// Exact trivial values.
	for _, m := range insecureSecretMarkers {
		if s == m || s == m+"123" || s == m+"!" {
			return true
		}
	}
	// Known chart / compose placeholders.
	placeholders := []string{"change-me", "local-dev-only", "insecure-default"}
	for _, p := range placeholders {
		if strings.Contains(s, p) {
			return true
		}
	}
	return false
}

func (c *Config) Validate() error {
	if c.DevMode {
		return nil
	}
	jwt := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len(jwt) < 32 {
		return errors.New("JWT_SECRET must be at least 32 characters when DEV_MODE is false")
	}
	if isInsecureSecret(jwt) {
		return errors.New("JWT_SECRET looks like a placeholder; set a strong random value")
	}
	adminPass := getEnv("ADMIN_PASSWORD", "")
	if adminPass == "" {
		return errors.New("ADMIN_PASSWORD must be set when DEV_MODE is false")
	}
	if isInsecureSecret(adminPass) || len(adminPass) < 12 {
		return errors.New("ADMIN_PASSWORD looks weak or like a placeholder; set a strong value")
	}
	if c.StorageDriver == "s3" {
		if c.StorageAccess == "" || c.StorageSecret == "" {
			return errors.New("STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY must be set when DEV_MODE is false")
		}
		if isInsecureSecret(c.StorageSecret) {
			return errors.New("STORAGE_SECRET_KEY looks like a placeholder; set a strong random value")
		}
	}
	return nil
}

func (c *Config) AllowedOrigins() []string {
	seen := map[string]bool{}
	var out []string
	add := func(o string) {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" || seen[o] {
			return
		}
		seen[o] = true
		out = append(out, o)
	}
	for _, o := range c.FrontendOrigins {
		add(o)
	}
	add(c.PublicURL)
	return out
}

// IsTrustedProxy reports whether ip is allowed to supply X-Real-IP / X-Forwarded-For.
func (c *Config) IsTrustedProxy(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, network := range c.TrustedProxyCIDRs {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// CookieSecure reports whether session cookies should set the Secure flag.
func (c *Config) CookieSecure() bool {
	return strings.HasPrefix(strings.ToLower(c.PublicURL), "https://")
}

func developmentSecret() string {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic("could not generate development JWT secret")
	}
	return hex.EncodeToString(raw[:])
}

// MustValidate is a helper for tests asserting Validate messages.
func FormatValidateError(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("%v", err)
}
