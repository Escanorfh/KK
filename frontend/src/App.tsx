import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/auth/LoginPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import DayPage from "./pages/day/DayPage";
import DataDayPage from "./pages/data-day/DataDayPage";
import WorkPage from "./pages/work/WorkPage";
import DataWorkPage from "./pages/data-work/DataWorkPage";
import FaultsPage from "./pages/faults/FaultsPage";
import OilAlertsPage from "./pages/oil-alerts/OilAlertsPage";
import OilConsumptionsPage from "./pages/oil-consumptions/OilConsumptionsPage";
import EquipmentPage from "./pages/equipment/EquipmentPage";
import TrackingModesPage from "./pages/tracking-modes/TrackingModesPage";
import RepairOrdersPage from "./pages/repair-orders/RepairOrdersPage";
import NeedRequestsPage from "./pages/need-requests/NeedRequestsPage";
import ProjectsPage from "./pages/projects/ProjectsPage";
import UsersPage from "./pages/users/UsersPage";
import DataManagementPage from "./pages/data-management/DataManagementPage";
import AppLayout from "./components/layout/AppLayout";
import RequireAuth from "./components/RequireAuth";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/day" element={<DayPage />} />
        <Route path="/data-day" element={<DataDayPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/data-work" element={<DataWorkPage />} />
        <Route path="/faults" element={<FaultsPage />} />
        <Route path="/oil-alerts" element={<OilAlertsPage />} />
        <Route path="/oil-consumptions" element={<OilConsumptionsPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route
          path="/tracking-modes"
          element={
            <RequireAuth roles={["ROOT", "ADMIN"]}>
              <TrackingModesPage />
            </RequireAuth>
          }
        />
        <Route path="/repair-orders" element={<RepairOrdersPage />} />
        <Route path="/need-requests" element={<NeedRequestsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route
          path="/users"
          element={
            <RequireAuth roles={["ROOT", "ADMIN"]}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/data-management"
          element={
            <RequireAuth roles={["ROOT"]}>
              <DataManagementPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
