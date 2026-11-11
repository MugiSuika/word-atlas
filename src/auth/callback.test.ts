import assert from "node:assert/strict";
import { test } from "node:test";
import { callbackReturnUrl, readAuthCallback } from "./callback";

const origin = "https://word-atlas.vidu8.online";

test("a pkce code is kept when the callback also carries an oauth error", () => {
  const callback = readAuthCallback(
    `${origin}/?auth_callback=1&code=auth-code&error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange#error=server_error&sb=`,
  );
  assert.equal(callback.code, "auth-code");
  assert.equal(callback.oauthError, true);
  assert.equal(callback.pending, true);
});

test("hash routes are not oauth errors and do not hide a query code", () => {
  assert.deepEqual(readAuthCallback(`${origin}/#/me`), {
    code: null,
    flowId: null,
    oauthError: false,
    pending: false,
  });
  const callback = readAuthCallback(
    `${origin}/?auth_callback=1&code=auth-code&sb_flow_id=flow123456#/me`,
  );
  assert.equal(callback.code, "auth-code");
  assert.equal(callback.flowId, "flow123456");
  assert.equal(callback.oauthError, false);
});

test("a canceled oauth redirect is an error without a code", () => {
  const callback = readAuthCallback(
    `${origin}/?auth_callback=1#error=access_denied&error_description=User+denied+access`,
  );
  assert.equal(callback.code, null);
  assert.equal(callback.oauthError, true);
  assert.equal(
    callbackReturnUrl(
      `${origin}/?auth_callback=1&code=auth-code&error=server_error#error=server_error`,
    ),
    `${origin}/#/me`,
  );
  assert.equal(
    callbackReturnUrl(`${origin}/?auth_callback=1&code=auth-code#/atlas`),
    `${origin}/#/atlas`,
  );
});
