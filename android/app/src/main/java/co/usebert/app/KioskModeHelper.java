package co.usebert.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

/** Immersive full-screen chrome and Lock Task helpers (best-effort; not a substitute for MDM). */
public final class KioskModeHelper {

    private KioskModeHelper() {}

    public static void applyImmersiveMode(Activity activity) {
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (window == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                View decorView = window.getDecorView();
                decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN);
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        });
    }

    public static void clearImmersiveMode(Activity activity) {
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (window == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            } else {
                View decorView = window.getDecorView();
                decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        });
    }

    public static boolean isLockTaskActive(Activity activity) {
        if (activity == null) {
            return false;
        }
        ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int mode = am.getLockTaskModeState();
            return mode != ActivityManager.LOCK_TASK_MODE_NONE;
        }
        return false;
    }

    public static String startLockTaskSafe(Activity activity) {
        if (activity == null) {
            return "No activity";
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return "Lock task requires Android 5+";
        }
        try {
            activity.startLockTask();
            return null;
        } catch (SecurityException e) {
            return "Lock task not allowed. Configure Screen Pinning, Device Owner / MDM kiosk, or allowlist this app.";
        } catch (IllegalArgumentException e) {
            return "Lock task not allowed for this activity.";
        } catch (Exception e) {
            return e.getMessage() != null ? e.getMessage() : "Unable to start lock task";
        }
    }

    public static String stopLockTaskSafe(Activity activity) {
        if (activity == null) {
            return "No activity";
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return null;
        }
        try {
            activity.stopLockTask();
            return null;
        } catch (Exception e) {
            return e.getMessage() != null ? e.getMessage() : "Unable to stop lock task";
        }
    }
}
