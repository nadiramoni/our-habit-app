package com.ourhabit.app;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import java.nio.charset.StandardCharsets;

/**
 * NearbySync — REAL device-to-device note transfer with NO internet, using
 * Google Play Services "Nearby Connections" (Bluetooth + Wi-Fi Direct under
 * the hood — the same tech Google Files / Nearby Share uses).
 *
 * JS protocol (see src/lib/nearby.ts):
 *   startAdvertising(name)  → this phone is discoverable
 *   startDiscovery()        → scan for the partner's phone
 *   connect(endpointId)     → both sides auto-accept
 *   send(text)              → one UTF-8 JSON string per payload (per note)
 *   Events back to JS: advertisingStarted | discoveryStarted | endpointFound |
 *     connected | connectionFailed | payloadReceived | disconnected | error
 */
@CapacitorPlugin(name = "NearbySync", permissions = {
    @Permission(
        strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE },
        alias = "bluetooth"
    ),
    @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location")
})
public class NearbySyncPlugin extends Plugin {

    private static final String SERVICE_ID = "com.ourhabit.app.notesync";

    private ConnectionsClient client;
    private String remoteEndpoint = null;
    private boolean connected = false;

    private ConnectionsClient client() {
        if (client == null) {
            client = Nearby.getConnectionsClient(getContext());
        }
        return client;
    }

    /** Ask the OS for the Bluetooth / location permissions Nearby needs. */
    @PluginMethod
    public void ensurePermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            requestPermissionForAliases(new String[] { "bluetooth" }, call, "permsCallback");
        } else {
            // Android 11 and below: Nearby Connections needs fine location
            requestPermissionForAliases(new String[] { "location" }, call, "permsCallback");
        }
    }

    @PermissionCallback
    private void permsCallback(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok;
        if (Build.VERSION.SDK_INT >= 31) {
            ok = PermissionState.GRANTED.equals(getPermissionStates().get("bluetooth"));
        } else {
            ok = PermissionState.GRANTED.equals(getPermissionStates().get("location"));
        }
        r.put("granted", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        String name = call.getString("name", "OurHabit");
        client().startAdvertising(
            name,
            SERVICE_ID,
            lifecycleCallback,
            new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build())
            .addOnSuccessListener(unused -> {
                JSObject r = new JSObject();
                r.put("ok", true);
                notifyListeners("advertisingStarted", r);
                call.resolve();
            })
            .addOnFailureListener(e -> {
                JSObject r = new JSObject();
                r.put("message", e.getMessage() == null ? "advertising_failed" : e.getMessage());
                notifyListeners("error", r);
                call.reject("advertising_failed", e);
            });
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        client().startDiscovery(
            SERVICE_ID,
            discoveryCallback,
            new com.google.android.gms.nearby.connection.DiscoveryOptions.Builder()
                .setStrategy(Strategy.P2P_STAR).build())
            .addOnSuccessListener(unused -> {
                JSObject r = new JSObject();
                r.put("ok", true);
                notifyListeners("discoveryStarted", r);
                call.resolve();
            })
            .addOnFailureListener(e -> {
                JSObject r = new JSObject();
                r.put("message", e.getMessage() == null ? "discovery_failed" : e.getMessage());
                notifyListeners("error", r);
                call.reject("discovery_failed", e);
            });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null) {
            call.reject("missing_endpoint");
            return;
        }
        String name = call.getString("name", "OurHabit");
        client().requestConnection(name, endpointId, lifecycleCallback)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> {
                JSObject r = new JSObject();
                r.put("message", e.getMessage() == null ? "connection_request_failed" : e.getMessage());
                notifyListeners("error", r);
                notifyListeners("connectionFailed", r);
                call.reject("connection_request_failed", e);
            });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String text = call.getString("text", "");
        if (!connected || remoteEndpoint == null) {
            call.reject("not_connected");
            return;
        }
        try {
            client().sendPayload(remoteEndpoint, text.getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            call.reject("send_failed", e);
        }
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        try {
            client().stopAllEndpoints();
            client().stopAdvertising();
            client().stopDiscovery();
        } catch (Exception ignored) {
        }
        connected = false;
        remoteEndpoint = null;
        call.resolve();
    }

    private final ConnectionLifecycleCallback lifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo connectionInfo) {
            // accept automatically; the pair-key check happens at payload level in JS
            client().acceptConnection(endpointId, payloadCallback);
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            r.put("endpointName", connectionInfo.getEndpointName());
            notifyListeners("connectionInitiated", r);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution result) {
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            if (result.getStatus().isSuccess()) {
                connected = true;
                remoteEndpoint = endpointId;
                try {
                    client().stopDiscovery();
                    client().stopAdvertising();
                } catch (Exception ignored) {
                }
                notifyListeners("connected", r);
            } else {
                connected = false;
                remoteEndpoint = null;
                notifyListeners("connectionFailed", r);
            }
        }

        @Override
        public void onDisconnected(String endpointId) {
            connected = false;
            remoteEndpoint = null;
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            notifyListeners("disconnected", r);
        }
    };

    private final EndpointDiscoveryCallback discoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            r.put("endpointName", info.getEndpointName());
            notifyListeners("endpointFound", r);
        }

        @Override
        public void onEndpointLost(String endpointId) {
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            notifyListeners("endpointLost", r);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
            if (payload.getType() != Payload.Type.BYTES || payload.asBytes() == null) return;
            String text = new String(payload.asBytes(), StandardCharsets.UTF_8);
            JSObject r = new JSObject();
            r.put("endpointId", endpointId);
            r.put("text", text);
            notifyListeners("payloadReceived", r);
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
            // notes are tiny — no progress UI needed
        }
    };

    @Override
    protected void handleOnDestroy() {
        try {
            if (client != null) client.stopAllEndpoints();
        } catch (Exception ignored) {
        }
        super.handleOnDestroy();
    }
}
