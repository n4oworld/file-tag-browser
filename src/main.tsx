import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 数据库连接由 Rust 端在 setup() 阶段初始化并常驻，
// 前端不需要做任何初始化，直接挂载 App 即可。
const rootEl = document.getElementById('root')!;
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);