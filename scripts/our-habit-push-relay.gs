/**
 * our-habit-push-relay.gs — Our Habit push relay (Apps Script)
 * ============================================================
 * The owner deploys this ONCE (Extensions → Apps Script → paste → Deploy as
 * Web app → Execute as: Me · Who has access: Anyone). The app POSTs:
 *
 *   { "secret": "<the same SECRET as below>", "messages": [ FCMv1Message, ... ] }
 *
 * each FCMv1Message is forwarded to FCM HTTP v1 (messages:send) signed with
 * the service account. v5.5 update broadcasts arrive as DATA-ONLY messages
 * (no `notification` block) — forward them EXACTLY as received, do NOT add
 * or require a notification block, or the closed-app voice announcement dies.
 *
 * Setup:
 *   1. Firebase Console → Project settings → Service accounts → Generate new
 *      private key → open the JSON → paste the WHOLE object into SERVICE_ACCOUNT.
 *   2. Change SECRET to your own random string, then put the same value in
 *      the app's admin panel (⚙️ সেটিংস → পুশ রিলে URL + Secret).
 *   3. Deploy → Web app → copy the /exec URL → paste into the admin panel.
 */

var SERVICE_ACCOUNT = {}; // ← paste the full service-account JSON object here
var SECRET = "ah-sakib-72542-xyz"; // ← must match the admin panel's Secret

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return out_({ ok: false, error: "bad_secret" });
    }
    var msgs = body.messages || [];
    var sent = 0, failed = 0, firstError = "";
    var token = getAccessToken_();
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m || !m.token) { failed++; continue; }
      var projectId = SERVICE_ACCOUNT.project_id;
      var res = UrlFetchApp.fetch(
        "https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send",
        {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + token },
          payload: JSON.stringify({ message: m }),
          muteHttpExceptions: true,
        }
      );
      if (res.getResponseCode() < 300) {
        sent++;
      } else {
        failed++;
        if (!firstError) firstError = res.getContentText().slice(0, 300);
      }
    }
    return out_({ ok: sent > 0 || (msgs.length > 0 && failed === 0), sent: sent, failed: failed, error: firstError });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function getAccessToken_() {
  if (SERVICE_ACCOUNT.private_key) {
    var now = Math.floor(Date.now() / 1000);
    var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    var claim = Utilities.base64EncodeWebSafe(JSON.stringify({
      iss: SERVICE_ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
    var toSign = header + "." + claim;
    var sig = Utilities.base64EncodeWebSafe(
      Utilities.computeRsaSha256Signature(toSign, SERVICE_ACCOUNT.private_key)
    ).replace(/=+$/, "");
    var jwt = toSign + "." + sig;
    var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
      method: "post",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      },
      muteHttpExceptions: true,
    });
    var j = JSON.parse(res.getContentText());
    if (j.access_token) return j.access_token;
    throw new Error("token_exchange_failed: " + res.getContentText().slice(0, 200));
  }
  // Fallback: script-level Advanced Google service / built-in identity
  return ScriptApp.getOAuthToken();
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
