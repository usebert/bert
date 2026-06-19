package co.usebert.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KioskMode")
public class KioskModePlugin extends Plugin {

    @PluginMethod
    public void applyImmersive(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        KioskModeHelper.applyImmersiveMode(activity);
        call.resolve();
    }

    @PluginMethod
    public void clearImmersive(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        KioskModeHelper.clearImmersiveMode(activity);
        call.resolve();
    }

    @PluginMethod
    public void startLockTask(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        String error = KioskModeHelper.startLockTaskSafe(activity);
        JSObject ret = new JSObject();
        ret.put("started", error == null);
        if (error != null) {
            ret.put("message", error);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stopLockTask(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        String error = KioskModeHelper.stopLockTaskSafe(activity);
        JSObject ret = new JSObject();
        ret.put("stopped", error == null);
        if (error != null) {
            ret.put("message", error);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Activity activity = getActivity();
        JSObject ret = new JSObject();
        if (activity == null) {
            ret.put("lockTaskActive", false);
            ret.put("lockTaskMode", ActivityManager.LOCK_TASK_MODE_NONE);
            call.resolve(ret);
            return;
        }
        ret.put("lockTaskActive", KioskModeHelper.isLockTaskActive(activity));
        ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        int mode = ActivityManager.LOCK_TASK_MODE_NONE;
        if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            mode = am.getLockTaskModeState();
        }
        ret.put("lockTaskMode", mode);
        call.resolve(ret);
    }
}
