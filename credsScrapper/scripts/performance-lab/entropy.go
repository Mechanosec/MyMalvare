// Experimental entropy-only kernel, not a replacement for the full detector.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"time"
)

var token = regexp.MustCompile(`[A-Za-z0-9+]{32,}={0,2}`)

func valid(s []byte) bool {
	var counts [256]int
	digits := 0
	for _, c := range s {
		counts[c]++
		if c >= '0' && c <= '9' {
			digits++
		}
	}
	if digits < 2 {
		return false
	}
	h := 0.0
	for _, n := range counts {
		if n > 0 {
			p := float64(n) / float64(len(s))
			h -= p * math.Log2(p)
		}
	}
	return h > 4
}
func char(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+'
}
func main() {
	data, _ := os.ReadFile(os.Args[1])
	results := []map[string]interface{}{}
	for _, mode := range []string{"regex", "ascii"} {
		for run := 0; run < 4; run++ {
			t := time.Now()
			count := 0
			indexSum := 0
			matches := [][2]int{}
			if mode == "regex" {
				for _, m := range token.FindAllIndex(data, -1) {
					if valid(data[m[0]:m[1]]) {
						count++
						indexSum += m[0]
						matches = append(matches, [2]int{m[0], m[1] - m[0]})
					}
				}
			} else {
				for i := 0; i < len(data); {
					start := i
					for i < len(data) && char(data[i]) {
						i++
					}
					end := i
					if end-start >= 32 {
						for n := 0; n < 2 && i < len(data) && data[i] == '='; n++ {
							i++
						}
						if valid(data[start:i]) {
							count++
							indexSum += start
							matches = append(matches, [2]int{start, i - start})
						}
					}
					if i == start {
						i++
					}
				}
			}
			elapsed := float64(time.Since(t).Nanoseconds()) / 1e6
			digest := sha256.New()
			for _, m := range matches {
				fmt.Fprintf(digest, "%d:%d\n", m[0], m[1])
			}
			if run > 0 {
				results = append(results, map[string]interface{}{"mode": mode, "ms": elapsed, "count": count, "indexSum": indexSum, "fingerprint": fmt.Sprintf("%x", digest.Sum(nil))})
			}
		}
	}
	json.NewEncoder(os.Stdout).Encode(results)
}
