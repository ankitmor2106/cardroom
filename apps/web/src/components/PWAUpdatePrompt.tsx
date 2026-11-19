import { useRegisterSW } from "virtual:pwa-register/react";

export function PWAUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return <aside className="pwa-prompt" role="status" aria-live="polite" aria-atomic="true">
    <p>{needRefresh ? "A new version of Cardroom is ready." : "Cardroom is ready to work offline on this device."}</p>
    <div>
      {needRefresh && <button type="button" className="pwa-update-action" onClick={() => void updateServiceWorker(true)}>Update now</button>}
      <button type="button" className="pwa-dismiss-action" onClick={dismiss}>Dismiss</button>
    </div>
  </aside>;
}
