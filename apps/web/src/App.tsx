import { Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { PageShell } from "./components/Shared";
import { useSessionStore } from "./store/session";
import { LandingPage, LibraryPage, GameIntroPage, CreateRoomPage, JoinRoomPage, LobbyPage, RulesPage, SettingsPage, ProfilePage, InfoPage, NotFoundPage, OfflinePage, ErrorPage, ResultsPage } from "./pages";
import { OfflineGamePage, OnlineGamePage } from "./games/pages";
import { PWAUpdatePrompt } from "./components/PWAUpdatePrompt";

export default function App() {
  const preferences = useSessionStore(s => s.preferences);
  const location = useLocation();
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.motion = preferences.reducedMotion ? "reduced" : "full";
  }, [preferences.theme, preferences.reducedMotion]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: preferences.reducedMotion ? "auto" : "smooth" }); }, [location.pathname, preferences.reducedMotion]);
  return <PageShell><PWAUpdatePrompt/><Suspense fallback={<div className="page-loading"><span className="spinner"/> Preparing the table…</div>}><Routes>
    <Route path="/" element={<LandingPage/>}/>
    <Route path="/games" element={<LibraryPage/>}/>
    <Route path="/games/:gameId" element={<GameIntroPage/>}/>
    <Route path="/create" element={<CreateRoomPage/>}/>
    <Route path="/join" element={<JoinRoomPage/>}/>
    <Route path="/join/:code" element={<JoinRoomPage/>}/>
    <Route path="/room/:code" element={<LobbyPage/>}/>
    <Route path="/room/:code/game" element={<OnlineGamePage/>}/>
    <Route path="/play/:gameId" element={<OfflineGamePage/>}/>
    <Route path="/results/:code" element={<ResultsPage/>}/>
    <Route path="/rules" element={<RulesPage/>}/>
    <Route path="/settings" element={<SettingsPage/>}/>
    <Route path="/profile" element={<ProfilePage/>}/>
    <Route path="/about" element={<InfoPage/>}/>
    <Route path="/privacy" element={<InfoPage privacy/>}/>
    <Route path="/offline" element={<OfflinePage/>}/>
    <Route path="/error" element={<ErrorPage/>}/>
    <Route path="*" element={<NotFoundPage/>}/>
  </Routes></Suspense></PageShell>;
}
