/* A deterministic, flower-like workload for the fuel experiment: a hash table, a sort and a hash chain over
 * static memory. No libc: it builds the same for wasm32 (clang --target=wasm32) and natively (gcc). */
typedef unsigned int u32;
typedef unsigned long long u64;

#define TABLE 65536
#define ARR 20000
static u32 keys[TABLE], vals[TABLE];
static u32 arr[ARR];

#ifdef __wasm__
/* no libc in the wasm build: the compiler turns the zeroing loop into a memset call */
void *memset(void *d, int c, unsigned long n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
#endif

static u32 xorshift(u32 *s) { u32 x = *s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; return *s = x; }

u64 work(u32 n) {
  u32 s = 2463534242u;
  u64 acc = 0;
  for (u32 i = 0; i < TABLE; i++) keys[i] = 0;
  for (u32 i = 0; i < n; i++) {           /* hash-table inserts and lookups (open addressing) */
    u32 k = (xorshift(&s) % 50000u) + 1u, h = (k * 2654435761u) & (TABLE - 1);
    while (keys[h] && keys[h] != k) h = (h + 1) & (TABLE - 1);
    if (!keys[h]) { keys[h] = k; vals[h] = 0; }
    vals[h] += i;
    acc += vals[h];
  }
  for (u32 i = 0; i < ARR; i++) arr[i] = xorshift(&s);
  for (u32 gap = ARR / 2; gap > 0; gap /= 2)   /* shell sort */
    for (u32 i = gap; i < ARR; i++) {
      u32 t = arr[i], j = i;
      while (j >= gap && arr[j - gap] > t) { arr[j] = arr[j - gap]; j -= gap; }
      arr[j] = t;
    }
  u64 h = 1469598103934665603ull;          /* FNV-1a chain over the sorted array */
  for (u32 r = 0; r < 40; r++)
    for (u32 i = 0; i < ARR; i++) { h ^= arr[i] + r; h *= 1099511628211ull; }
  return acc ^ h;
}
