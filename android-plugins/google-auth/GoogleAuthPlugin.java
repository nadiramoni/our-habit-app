package com.ourhabit.app;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;

/**
 * GoogleAuthPlugin — v2.9 THE GOOGLE LOGIN FIX (owner: "সাদা হয়ে যায় —
 * লগইন বা সাইন আপ কোনোটাই কাজ করতেছে না").
 *
 * ROOT CAUSE of the white screen: the app used firebase signInWithPopup()
 * inside the Capacitor WebView. The WebView cannot host OAuth popups —
 * Android hijacked the flow into the EXTERNAL browser (Firefox) at
 * our-habit-61587.firebaseapp.com, which rendered a blank page and could
 * never redirect back into the app. The JS promise NEVER resolved → the
 * button stayed "..." forever. (Email login hung on the SDK's IndexedDB
 * persistence layer — fixed on the JS side with browserLocalPersistence.)
 *
 * THE FIX: the NATIVE Google account picker (Google Play Services sheet
 * slides up INSIDE the app — no browser, no redirect). It returns a real
 * idToken; the JS side exchanges it via
 * signInWithCredential(GoogleAuthProvider.credential(idToken)).
 *
 * JS bridge (window.Capacitor.Plugins.GoogleAuth):
 *   signIn({webClientId}) → {idToken, email, name, photoUrl} | reject(code,msg)
 *   signOut()
 *
 * ⚠️ The APK must be signed with a keystore whose SHA-1 is registered in the
 * Firebase Console (Project settings → Android app com.ourhabit.app).
 * prepare-apk signs every debug build with android-keystore/ourhabit-debug.keystore
 * → stable SHA-1: 14:60:22:E8:17:39:C5:38:0E:6C:E6:A4:36:FC:1B:33:4E:BA:92:16
 * Without it Google returns ApiException 10 (DEVELOPER_ERROR) — surfaced to
 * the user as a clear instruction instead of a silent hang.
 */
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

  /** Fallback web client id (client_type 3 of google-services.json, stable). */
  private static final String FALLBACK_WEB_CLIENT_ID =
      "570611135763-otc19ruqa5vs6dbl44982559iqhpp8de.apps.googleusercontent.com";

  @PluginMethod
  public void signIn(PluginCall call) {
    try {
      Activity act = getActivity();
      if (act == null) {
        call.reject("no_activity", "Activity is not ready");
        return;
      }
      String webClientId = call.getString("webClientId");
      if (webClientId == null || webClientId.isEmpty()) {
        webClientId = readResString(act, "default_web_client_id");
      }
      if (webClientId == null || webClientId.isEmpty()) {
        webClientId = FALLBACK_WEB_CLIENT_ID;
      }
      final String clientId = webClientId;
      GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
          .requestIdToken(clientId)
          .requestEmail()
          .requestProfile()
          .build();
      GoogleSignInClient client = GoogleSignIn.getClient(act, gso);
      // fresh account picker every time — the owner SWITCHES accounts
      // (sakib lifestyle01 ↔ nadira moni) and must be able to pick either.
      client.signOut();
      Intent intent = client.getSignInIntent();
      startActivityForResult(call, intent, "onGoogleResult");
    } catch (Exception e) {
      call.reject("start_failed", e.getMessage() == null ? "start failed" : e.getMessage());
    }
  }

  @ActivityCallback
  private void onGoogleResult(PluginCall call, ActivityResult result) {
    if (call == null) return; // call already answered
    try {
      if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
        // user pressed back on the account sheet → cancel, not an error
        call.reject("cancelled", "User cancelled the account picker");
        return;
      }
      GoogleSignInAccount account =
          GoogleSignIn.getSignedInAccountFromIntent(result.getData()).getResult(ApiException.class);
      if (account == null || account.getIdToken() == null) {
        call.reject("no_token", "Google returned no idToken");
        return;
      }
      JSObject ret = new JSObject();
      ret.put("idToken", account.getIdToken());
      ret.put("email", account.getEmail() == null ? "" : account.getEmail());
      ret.put("name", account.getDisplayName() == null ? "" : account.getDisplayName());
      ret.put("photoUrl", account.getPhotoUrl() == null ? "" : account.getPhotoUrl().toString());
      call.resolve(ret);
    } catch (ApiException e) {
      // code 10 = DEVELOPER_ERROR → the APK's SHA-1 is not in Firebase Console
      call.reject("google_" + e.getStatusCode(), e.getMessage() == null ? "" : e.getMessage());
    } catch (Exception e) {
      call.reject("failed", e.getMessage() == null ? "failed" : e.getMessage());
    }
  }

  @PluginMethod
  public void signOut(PluginCall call) {
    try {
      Activity act = getActivity();
      if (act != null) {
        GoogleSignIn.getClient(act, GoogleSignInOptions.DEFAULT_SIGN_IN).signOut();
      }
      call.resolve();
    } catch (Exception e) {
      call.resolve(); // never block sign-out
    }
  }

  private static String readResString(Activity act, String name) {
    try {
      int id = act.getResources().getIdentifier(name, "string", act.getPackageName());
      if (id != 0) return act.getString(id);
    } catch (Exception ignored) {
    }
    return null;
  }
}
