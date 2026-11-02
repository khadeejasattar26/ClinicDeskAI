import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { ClinicPage } from './ClinicPage';
import './global.css';
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><a href="#main-content" className="skip">Skip to content</a><Routes><Route path="/" element={<ClinicPage/>}/><Route path="*" element={<main id="main-content" style={{ padding: 50 }}><h1>Page not found</h1><Link to="/">Return to CareWell</Link></main>}/></Routes></BrowserRouter></StrictMode>);
