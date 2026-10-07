package api

import (
	"net/http"
	"reflect"
	"strconv"
)

const (
	defaultPageSize = 10
	maxPageSize     = 100
)

type pageParams struct {
	Page     int
	PageSize int
	Offset   int
}

// parsePageParams reads page + pageSize (or limit) from the query string.
// Defaults: page=1, pageSize=10. pageSize is capped at 100.
func parsePageParams(r *http.Request) pageParams {
	page := 1
	pageSize := defaultPageSize

	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	if v := r.URL.Query().Get("pageSize"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			pageSize = n
		}
	} else if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}

	return pageParams{
		Page:     page,
		PageSize: pageSize,
		Offset:   (page - 1) * pageSize,
	}
}

func writePage(w http.ResponseWriter, items any, total int64, p pageParams) {
	if items == nil {
		items = []any{}
	} else {
		v := reflect.ValueOf(items)
		if v.Kind() == reflect.Slice && v.IsNil() {
			items = reflect.MakeSlice(v.Type(), 0, 0).Interface()
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":    items,
		"total":    total,
		"page":     p.Page,
		"pageSize": p.PageSize,
	})
}
