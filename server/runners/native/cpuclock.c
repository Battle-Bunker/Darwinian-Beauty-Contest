// Exact thread CPU clocks for the TypeScript runner (Node has none: process.threadCpuUsage() is stale by up to
// a scheduler tick for a running thread). Built by ts_runner.cjs on first use (gcc or cc, Node's headers); the
// runner falls back to threadCpuUsage() if it can't be.
//   threadCpuMs()  this thread's CPU time, ms (CLOCK_THREAD_CPUTIME_ID: exact, and it leaves out host steal)
//   clockId()      this thread's CPU clock id, for another thread of the process to read
//   cpuMsOf(id)    that clock, ms (exact even while the thread runs), or undefined
#include <node_api.h>
#include <pthread.h>
#include <time.h>

static napi_value ms_of(napi_env env, clockid_t id) {
  struct timespec ts;
  napi_value r;
  if (clock_gettime(id, &ts) != 0) { napi_get_undefined(env, &r); return r; }
  napi_create_double(env, (double)ts.tv_sec * 1e3 + (double)ts.tv_nsec / 1e6, &r);
  return r;
}

static napi_value thread_cpu_ms(napi_env env, napi_callback_info info) { return ms_of(env, CLOCK_THREAD_CPUTIME_ID); }

static napi_value clock_id(napi_env env, napi_callback_info info) {
  clockid_t id;
  napi_value r;
  if (pthread_getcpuclockid(pthread_self(), &id) != 0) { napi_get_undefined(env, &r); return r; }
  napi_create_int32(env, (int32_t)id, &r);
  return r;
}

static napi_value cpu_ms_of(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t id;
  napi_value r;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1 ||
      napi_get_value_int32(env, argv[0], &id) != napi_ok) { napi_get_undefined(env, &r); return r; }
  return ms_of(env, (clockid_t)id);
}

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
    { "threadCpuMs", NULL, thread_cpu_ms, NULL, NULL, NULL, napi_default, NULL },
    { "clockId", NULL, clock_id, NULL, NULL, NULL, napi_default, NULL },
    { "cpuMsOf", NULL, cpu_ms_of, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, 3, props);
  return exports;
}
