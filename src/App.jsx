import React, { useState, useEffect, useRef } from 'react';

// --- Helpers for Date/Epoch Conversion ---
const epochToDateTimeLocal = (epoch) => {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const dateTimeLocalToEpoch = (dateTimeStr) => Math.floor(new Date(dateTimeStr).getTime() / 1000);

export default function App() {
  const [config, setConfig] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); 
  const [mediaFiles, setMediaFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [editingApp, setEditingApp] = useState(null);

  const ws = useRef(null);
  const HOST = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  const API_BASE = `http://${HOST}:5000`; 
  const WS_URL = `ws://${HOST}:5000/ws`;

  useEffect(() => {
    connectWebSocket();
    fetchMedia();
    return () => ws.current?.close();
  }, []);

  const connectWebSocket = () => {
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = () => { setIsConnected(true); sendCommand('getConfig'); };
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.result?.version) updateLocalState(data.result);
      if (data.method === 'stateChanged') updateLocalState(data.params);
    };
    ws.current.onclose = () => { setIsConnected(false); setTimeout(connectWebSocket, 3000); };
  };

  const updateLocalState = (conf) => {
    setConfig(conf);
    if (editingApp) setEditingApp(conf.applications.find(a => a.id === editingApp.id) || null);
  };

  const sendCommand = (method, params = {}) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }));
    }
  };

  const fetchMedia = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/media`);
      if (res.ok) setMediaFiles(await res.json());
    } catch (e) { console.error(e); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      if ((await fetch(`${API_BASE}/api/media`, { method: "POST", body: formData })).ok) 
        setTimeout(fetchMedia, 500);
    } catch (err) { alert("Upload error"); }
    setIsUploading(false);
    e.target.value = null;
  };

  if (!config) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-blue-500 font-black uppercase tracking-widest animate-pulse">Connecting...</div>;

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
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Name</label>
              <input type="text" value={editingApp.name} onChange={(e) => setEditingApp({...editingApp, name: e.target.value})} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 outline-none focus:ring-1 ring-blue-500" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Logic</label>
                <select value={editingApp.type} onChange={(e) => setEditingApp({...editingApp, type: e.target.value})} className="w-full bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 text-xs font-bold uppercase">
                  <option value="clock">Clock</option>
                  <option value="time-elapsed">Elapsed</option>
                  <option value="countdown">Countdown</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Watchface</label>
                <select value={editingApp.watchface} onChange={(e) => setEditingApp({...editingApp, watchface: e.target.value})} className="w-full bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 text-xs font-bold uppercase">
                  <option value="clock">Analog</option>
                  <option value="seven-segment">Digital</option>
                  <option value="round-progress-bar">Progress</option>
                </select>
              </div>
            </div>

            {editingApp.type !== 'clock' && (
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Target Date/Time</label>
                <input type="datetime-local" value={epochToDateTimeLocal(editingApp.timestamp)} onChange={(e) => setEditingApp({...editingApp, timestamp: dateTimeLocalToEpoch(e.target.value)})} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 [color-scheme:dark] text-xs" />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Background Asset</label>
              <select value={editingApp.background || ''} onChange={(e) => setEditingApp({...editingApp, background: e.target.value})} className="w-full bg-gray-800 rounded-xl px-4 py-2 border border-gray-700 text-xs font-bold uppercase">
                <option value="">None</option>
                {mediaFiles.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div className="flex space-x-4 pt-2">
              <div className="flex-1 text-center">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Base Color</label>
                <input type="color" value={editingApp['base-color'] || '#000000'} onChange={(e) => setEditingApp({...editingApp, 'base-color': e.target.value})} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
              </div>
              <div className="flex-1 text-center">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Accent Color</label>
                <input type="color" value={editingApp['accent-color'] || '#ffffff'} onChange={(e) => setEditingApp({...editingApp, 'accent-color': e.target.value})} className="w-12 h-12 rounded-full cursor-pointer bg-transparent border-0 mx-auto block shadow-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 pb-24 font-sans">
      <header className="flex justify-between items-center mb-8 max-w-md mx-auto">
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">BEE CORE</h1>
        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
      </header>

      <div className="max-w-md mx-auto space-y-6">
        {activeTab === 'dashboard' ? (
          <>
            <section className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-2xl">
              <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-4 italic">Active Display</h2>
              <select value={config.active_app_id} onChange={(e) => sendCommand('setActiveApp', { app_id: e.target.value })} className="w-full bg-gray-800 rounded-2xl px-5 py-4 border border-gray-700 font-black text-lg italic uppercase outline-none focus:ring-2 ring-blue-500 appearance-none">
                {config.applications.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
              </select>
            </section>

            <section className="bg-gray-900 border border-gray-800 rounded-3xl p-6">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-widest italic">Installed Apps</h2>
                <button onClick={() => sendCommand('addApp', { id: `app-${Date.now()}`, name: "New Entry", type: "clock", enabled: true })} className="text-blue-500 text-[10px] font-black uppercase tracking-widest hover:text-blue-400">Add New</button>
              </div>
              <div className="space-y-3">
                {config.applications.map((app) => (
                  <div key={app.id} className="p-4 bg-gray-800/40 border border-gray-800 rounded-2xl flex items-center justify-between">
                    <span className="font-black text-sm uppercase italic tracking-tight truncate mr-4">{app.name}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingApp(app)} className="text-[9px] bg-gray-700 px-4 py-2 rounded-lg font-black uppercase tracking-widest">Edit</button>
                      <button onClick={() => { if(window.confirm(`Delete ${app.name}?`)) sendCommand('removeApp', { id: app.id }); }} 
                              className="text-[9px] bg-red-900/20 text-red-500 px-4 py-2 rounded-lg font-black uppercase tracking-widest">Del</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
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
        )}
      </div>

      <nav className="fixed bottom-6 left-6 right-6 bg-gray-900/90 backdrop-blur-xl border border-gray-800 rounded-full p-2 flex justify-around shadow-2xl">
        <button onClick={() => setActiveTab('dashboard')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Control</button>
        <button onClick={() => setActiveTab('media')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-full ${activeTab === 'media' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500'}`}>Library</button>
      </nav>
    </div>
  );
}
