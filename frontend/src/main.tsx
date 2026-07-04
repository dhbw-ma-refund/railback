import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/mockInterceptor'; // Enable mock API
import App from './App';
import '@shared/styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
