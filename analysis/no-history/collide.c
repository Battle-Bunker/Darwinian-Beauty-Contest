// Concern 1 in C (OpenSSL SHA-256, SHA-NI on this machine): fingerprint trials per second per core, for a forger
// whose key has a free field the fingerprint covers (the cheapest family), and sha256 key stretching per
// iteration. Also finds a real 3-byte collision against a random target, on one core (a 4-byte one takes
// 256 times as long: extrapolate).
//   gcc -O2 collide.c -lcrypto -o collide && ./collide
#include <openssl/sha.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }
int main(void) {
  unsigned char key[72], d[32];
  for (int i = 0; i < 64; i++) key[i] = (unsigned char)(i * 37 + 11);
  // 1. single-core trial rate (64-byte key + 8-byte nonce)
  double t0 = now(); uint64_t n = 0;
  while (now() - t0 < 1.0) { for (int k = 0; k < 100000; k++, n++) { memcpy(key + 64, &n, 8); SHA256(key, 72, d); } }
  double single = n / (now() - t0);
  // 2. stretching: iterated sha256 on 32 bytes
  t0 = now(); uint64_t m = 0; unsigned char v[32] = {1};
  while (now() - t0 < 1.0) { for (int k = 0; k < 100000; k++, m++) SHA256(v, 32, v); }
  double stretch = m / (now() - t0);
  // 3. a real 3-byte collision, one core
  unsigned char target[3] = {0xde, 0xad, 0xbe};
  t0 = now(); uint64_t i = 0;
  for (;; i++) { memcpy(key + 64, &i, 8); SHA256(key, 72, d); if (!memcmp(d, target, 3)) break; }
  double t3 = now() - t0;
  printf("{\"c_single\": %.0f, \"c_stretch\": %.0f, \"c_found3_s\": %.3f, \"c_found3_trials\": %llu}\n",
         single, stretch, t3, (unsigned long long)i);
  return 0;
}
