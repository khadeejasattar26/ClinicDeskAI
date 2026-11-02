import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { AdminDashboard } from './AdminDashboard';
import { AdminLogin } from './AdminLogin';
export default function AdminRoutes() {
  return <AuthProvider><Routes><Route index element={<AdminDashboard/>}/><Route path="login" element={<AdminLogin/>}/><Route path="*" element={<Navigate to="/admin" replace/>}/></Routes></AuthProvider>;
}
