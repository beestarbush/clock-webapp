import React, { useState, useEffect, useRef } from 'react';

// --- Helpers for Date/Epoch Conversion ---
const epochToDateTimeLocal = (epoch) => {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const dateTimeLocalToEpoch = (dateTimeStr) => Math.floor(new Date(dateTimeStr).getTime() / 1000);

const formatUptime = (seconds) => {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
};

export default function App() {
  const [config, setConfig] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [editingSystemConfig, setEditingSystemConfig] = useState(null);
  const [editingDeviceId, setEditingDeviceId] = useState(null);
  const [appStatus, setAppStatus] = useState({ version: null });
  const [backendStatus, setBackendStatus] = useState({ uptime: null });
  const [temperature, setTemperature] = useState(null);

  const ws = useRef(null);
  const pendingRequests = useRef({});
  const nextId = useRef(1);
  const HOST = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  const API_BASE = `http://${HOST}:5000`;
  const WS_URL = `ws://${HOST}:5000/ws`;

  useEffect(() => {
    connectWebSocket();
    return () => ws.current?.close();
  }, []);

  const connectWebSocket = () => {
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = () => {
      setIsConnected(true);
      // Subscribe to topics (current state will be sent immediately)
      request('subscribe', { topic: 'configuration' });
      request('subscribe', { topic: 'media' });
      request('subscribe', { topic: 'temperature' });
      request('subscribe', { topic: 'backend-status' });
      // Fetch initial state
      request('getConfig', {}, (result) => updateLocalState(result));
      request('getMedia', {}, (result) => setMediaFiles(result.files || []));
      request('getStatus', {}, (result) => setAppStatus(result));
      request('getTemperature', {}, (result) => setTemperature(result.temperature));
    };
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'response' && data.id) {
        // Correlated response — invoke pending callback
        const callback = pendingRequests.current[data.id];
        if (callback) {
          delete pendingRequests.current[data.id];
          if (data.result) callback(data.result);
          else if (data.error) console.error('Request error:', data.error.message);
        }
      } else if (data.type === 'publish') {
        // Topic-based publish from server
        if (data.topic === 'configuration') updateLocalState(data.params);
        if (data.topic === 'media') setMediaFiles(data.params?.files || []);
        if (data.topic === 'temperature') setTemperature(data.params?.temperature || null);
        if (data.topic === 'backend-status') setBackendStatus(data.params || {});
      }
    };
    ws.current.onclose = () => {
      setIsConnected(false);
      pendingRequests.current = {};
      setTimeout(connectWebSocket, 3000);
    };
  };

  const updateLocalState = (conf) => {
    setConfig(conf);
    if (editingApp) setEditingApp(conf.applications.find(a => a.id === editingApp.id) || null);
    if (editingSystemConfig) setEditingSystemConfig({ ...conf['system-configuration'] });
    if (editingDeviceId !== null) setEditingDeviceId(conf.device_id || '');
  };

  /** Send a request and optionally handle the response via callback */
  const request = (method, params = {}, onResult = null) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      const id = String(nextId.current++);
      if (onResult) pendingRequests.current[id] = onResult;
      ws.current.send(JSON.stringify({ jsonrpc: "2.0", type: "request", method, params, id }));
    }
  };

  /** Fire-and-forget convenience — same as request without callback */
  const sendCommand = (method, params = {}) => request(method, params);

  const getOrderedApplications = (applications = []) => {
    return [...applications].sort((a, b) => {
      const orderA = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''));
    });
  };

  const moveApplication = (appId, direction) => {
    const orderedApps = getOrderedApplications(config.applications);
    const currentIndex = orderedApps.findIndex((app) => app.id === appId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedApps.length) return;

    const swapped = [...orderedApps];
    [swapped[currentIndex], swapped[targetIndex]] = [swapped[targetIndex], swapped[currentIndex]];

    const reorderedApps = swapped.map((app, index) => ({ ...app, order: index }));
    const changedApps = reorderedApps.filter((app, index) => app.order !== orderedApps[index].order || app.id !== orderedApps[index].id);

    changedApps.forEach((app) => sendCommand('updateApp', app));

    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        applications: reorderedApps
      };
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      await fetch(`${API_BASE}/api/media`, { method: "POST", body: formData });
    } catch (err) { alert("Upload error"); }
    setIsUploading(false);
    e.target.value = null;
  };

  if (!config) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-blue-500 font-black uppercase tracking-widest animate-pulse">Connecting...</div>;

  const orderedApplications = getOrderedApplications(config.applications);

  // ==========================================
  // VIEW: FULL EDITOR (RESTORED PROPERTIES)
  // ==========================================
  if (editingApp) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-4 pb-24 font-sans">
        <header className="flex justify-between items-center mb-6 max-w-md mx-auto">
          <button onClick={() => setEditingApp(null)} className="text-blue-500 font-black text-xs uppercase tracking-tighter">← Back</button>
          <h1 className="text-lg font-black uppercase tracking-tighter">App Editor</h1>
          <button onClick={() => { sendCommand('updateApp', editingApp); setEditingApp(null); }} className="bg-blue-600 px-5 py-1 rounded text-xs font-black uppercase italic">Save</button>
        </header>

        <div className="space-y-4 max-w-md mx-auto">
          {/* Visual Preview */}
          <div className="bg-gray-900 border border-gray-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="h-44 bg-black flex items-center justify-center">
              {editingApp.background ? (
                <img src={`${API_BASE}/media/${editingApp.background}`} className="w-full h-full object-contain" alt="preview" />
              ) : (
                <div className="text-gray-800 font-black text-[10px] uppercase">No Asset Selected</div>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Name</label>
                <input type="text" value={editingApp.name} onChange={(e) => setEditingApp({ ...editingApp, name: e.target.value })} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 outline-none focus:ring-1 ring-blue-500" />
              </div>
              <div className="ml-4 pt-5">
                <button
                  onClick={() => setEditingApp({ ...editingApp, enabled: !editingApp.enabled })}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${editingApp.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
                >
                  <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${editingApp.enabled ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Logic</label>
                <select value={editingApp.type} onChange={(e) => setEditingApp({ ...editingApp, type: e.target.value })} className="w-full bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 text-xs font-bold uppercase">
                  <option value="clock">Clock</option>
                  <option value="time-elapsed">Elapsed</option>
                  <option value="countdown">Countdown</option>
                  <option value="no-operation">No Operation</option>
                  <option value="current-date">Current Date</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Watchface</label>
                <select value={editingApp.watchface} onChange={(e) => setEditingApp({ ...editingApp, watchface: e.target.value })} className="w-full bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 text-xs font-bold uppercase">
                  <option value="clock">Analog</option>
                  <option value="seven-segment">Digital</option>
                  <option value="round-progress-bar">Progress</option>
                  <option value="photo-frame">Photo Frame</option>
                  <option value="date-frame">Date Frame</option>
                </select>
              </div>
            </div>

            {editingApp.type !== 'clock' && editingApp.type !== 'no-operation' && editingApp.type !== 'current-date' && editingApp.type !== 'date-display' && (
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Target Date/Time</label>
                <input type="datetime-local" value={epochToDateTimeLocal(editingApp.timestamp)} onChange={(e) => setEditingApp({ ...editingApp, timestamp: dateTimeLocalToEpoch(e.target.value), initialized: true })} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 [color-scheme:dark] text-xs" />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Background Asset</label>
              <select value={editingApp.background || ''} onChange={(e) => setEditingApp({ ...editingApp, background: e.target.value })} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 text-xs font-bold uppercase">
                <option value="">None</option>
                {mediaFiles.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Background Opacity</label>
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="1" step="0.05" value={editingApp['background-opacity'] ?? 0.5} onChange={(e) => setEditingApp({ ...editingApp, 'background-opacity': parseFloat(e.target.value) })} className="flex-1 accent-blue-500" />
                <span className="text-xs font-bold text-gray-400 w-8 text-right">{Math.round((editingApp['background-opacity'] ?? 0.5) * 100)}%</span>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Display Duration</label>
              <div className="flex items-center gap-3">
                <input type="range" min="3" max="60" step="1" value={editingApp['duration'] ?? 10} onChange={(e) => setEditingApp({ ...editingApp, 'duration': parseInt(e.target.value) })} className="flex-1 accent-blue-500" />
                <span className="text-xs font-bold text-gray-400 w-8 text-right">{editingApp['duration'] ?? 10}s</span>
              </div>
            </div>

            <div className="flex space-x-4 pt-2">
              <div className="flex-1 text-center">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Base Color</label>
                <input type="color" value={editingApp['base-color'] || '#000000'} onChange={(e) => setEditingApp({ ...editingApp, 'base-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
              </div>
              <div className="flex-1 text-center">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Accent Color</label>
                <input type="color" value={editingApp['accent-color'] || '#ffffff'} onChange={(e) => setEditingApp({ ...editingApp, 'accent-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
              </div>
            </div>

            {editingApp.type === 'clock' && (
              <div className="flex space-x-4 pt-2">
                <div className="flex-1 text-center">
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Hour</label>
                  <input type="color" value={editingApp['hour-color'] || '#995000'} onChange={(e) => setEditingApp({ ...editingApp, 'hour-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                </div>
                <div className="flex-1 text-center">
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Minute</label>
                  <input type="color" value={editingApp['minute-color'] || '#005099'} onChange={(e) => setEditingApp({ ...editingApp, 'minute-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                </div>
                <div className="flex-1 text-center">
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Second</label>
                  <input type="color" value={editingApp['second-color'] || '#009950'} onChange={(e) => setEditingApp({ ...editingApp, 'second-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 pb-24 font-sans">
      <header className="flex justify-between items-center mb-8 max-w-md mx-auto">
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">Clock gearhouse</h1>
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
      </header>

      <div className="max-w-md mx-auto space-y-6">
        {activeTab === 'dashboard' ? (
          <>
            <section className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest italic">Installed Apps</h2>
                <button onClick={() => sendCommand('addApp', {
                  id: `app-${Date.now()}`,
                  name: "New Entry",
                  type: "clock",
                  watchface: "clock",
                  enabled: false,
                  "base-color": "#000000",
                  "accent-color": "#bbbbbb",
                  "background": "",
                  "background-opacity": 0.5,
                  timestamp: 0,
                  initialized: false,
                  order: orderedApplications.length
                })} className="text-blue-500 text-[10px] font-black uppercase tracking-widest hover:text-blue-400">Add New</button>
              </div>
              <div className="space-y-3">
                {orderedApplications.map((app, index) => (
                  <div key={app.id} className="p-4 bg-gray-800/40 border border-gray-800 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => sendCommand('updateApp', { ...app, enabled: !app.enabled })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${app.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${app.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <span className={`font-black text-sm uppercase italic tracking-tight truncate ${!app.enabled ? 'text-gray-600' : ''}` }>{app.name}</span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => moveApplication(app.id, 'up')}
                        disabled={index === 0}
                        className="text-[9px] bg-gray-700 px-3 py-2 rounded-lg font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveApplication(app.id, 'down')}
                        disabled={index === orderedApplications.length - 1}
                        className="text-[9px] bg-gray-700 px-3 py-2 rounded-lg font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ↓
                      </button>
                      <button onClick={() => setEditingApp(app)} className="text-[9px] bg-gray-700 px-4 py-2 rounded-lg font-black uppercase tracking-widest">Edit</button>
                      <button onClick={() => { if (window.confirm(`Delete ${app.name}?`)) sendCommand('removeApp', { id: app.id }); }}
                        className="text-[9px] bg-red-900/20 text-red-500 px-4 py-2 rounded-lg font-black uppercase tracking-widest">Del</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : activeTab === 'media' ? (
          <section className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
            <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-4 italic">Media Library</h2>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-800 border-dashed rounded-3xl cursor-pointer bg-gray-800/20 mb-6 hover:bg-gray-800/40 transition-all">
              <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{isUploading ? 'Transferring...' : 'Upload Asset'}</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              {mediaFiles.map(file => (
                <div key={file} className="bg-black border border-gray-800 rounded-2xl overflow-hidden shadow-lg">
                  <div className="aspect-video flex items-center justify-center overflow-hidden">
                    <img src={`${API_BASE}/media/${file}`} className="w-full h-full object-cover" alt="" />
                  </div>
                  <div className="p-2 text-[8px] font-mono text-gray-600 truncate uppercase tracking-tighter">{file}</div>
                </div>
              ))}
            </div>
          </section>
        ) : activeTab === 'settings' ? (
          <section className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest italic">System Settings</h2>
                <button onClick={() => { 
                  sendCommand('updateSystemConfig', editingSystemConfig); 
                  if (editingDeviceId !== null && editingDeviceId !== config.device_id) {
                    sendCommand('setDeviceId', { device_id: editingDeviceId });
                  }
                }} className="bg-blue-600 px-5 py-1 rounded text-xs font-black uppercase italic">Save</button>
              </div>

              {editingSystemConfig && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-3">Pendulum</h3>
                    <div className="flex space-x-4">
                      <div className="flex-1 text-center">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Bob</label>
                        <input type="color" value={editingSystemConfig['pendulum-bob-color'] || '#009950'} onChange={(e) => setEditingSystemConfig({ ...editingSystemConfig, 'pendulum-bob-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                      </div>
                      <div className="flex-1 text-center">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Rod</label>
                        <input type="color" value={editingSystemConfig['pendulum-rod-color'] || '#333333'} onChange={(e) => setEditingSystemConfig({ ...editingSystemConfig, 'pendulum-rod-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                      </div>
                      <div className="flex-1 text-center">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Background</label>
                        <input type="color" value={editingSystemConfig['pendulum-background-color'] || '#000000'} onChange={(e) => setEditingSystemConfig({ ...editingSystemConfig, 'pendulum-background-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-3">System Colors</h3>
                    <div className="flex space-x-4">
                      <div className="flex-1 text-center">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Base</label>
                        <input type="color" value={editingSystemConfig['base-color'] || '#000000'} onChange={(e) => setEditingSystemConfig({ ...editingSystemConfig, 'base-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                      </div>
                      <div className="flex-1 text-center">
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Accent</label>
                        <input type="color" value={editingSystemConfig['accent-color'] || '#ffffff'} onChange={(e) => setEditingSystemConfig({ ...editingSystemConfig, 'accent-color': e.target.value })} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-3">Device ID</h3>
                    <input type="text" value={editingDeviceId || ''} onChange={(e) => setEditingDeviceId(e.target.value)} placeholder="e.g., SN-1001" className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 outline-none focus:ring-1 ring-blue-500 text-sm text-gray-200" />
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-5 italic">Device Info</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-gray-800">
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version</span>
                  <span className="text-sm font-bold text-gray-200">{appStatus.version || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-800">
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Uptime</span>
                  <span className="text-sm font-bold text-gray-200">{backendStatus.uptime != null ? formatUptime(backendStatus.uptime) : '—'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-800">
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Temperature</span>
                  <span className="text-sm font-bold text-gray-200">{temperature != null ? `${(temperature / 1000).toFixed(1)}°C` : '—'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-800">
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Device ID</span>
                  <span className="text-sm font-bold text-gray-200">{config.device_id || '—'}</span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Connection</span>
                  <span className={`text-sm font-bold ${isConnected ? 'text-green-500' : 'text-red-500'}`}>{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <nav className="fixed bottom-6 left-6 right-6 bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-full p-2 flex justify-around shadow-2xl">
        <button onClick={() => { setActiveTab('info'); request('getStatus', {}, (result) => setAppStatus(result)); }} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'info' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Info</button>
        <button onClick={() => setActiveTab('dashboard')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Apps</button>
        <button onClick={() => setActiveTab('media')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'media' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Library</button>
        <button onClick={() => { setActiveTab('settings'); setEditingSystemConfig({ ...config['system-configuration'] }); setEditingDeviceId(config.device_id || ''); }} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'settings' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Settings</button>
      </nav>
    </div>
  );
}
