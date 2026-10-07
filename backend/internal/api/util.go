package api

import "strconv"

func strconvFormatInt(v int64) string {
	return strconv.FormatInt(v, 10)
}
