import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireStaff } from './components/RequireStaff';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { NorthStarPage } from './pages/NorthStarPage';
import { AccountsPage } from './pages/AccountsPage';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { UsagePage } from './pages/UsagePage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { MeteringPage } from './pages/MeteringPage';
import { AiBudgetsPage } from './pages/AiBudgetsPage';
import { TokenUsagePage } from './pages/TokenUsagePage';
import { AiReconciliationPage } from './pages/AiReconciliationPage';
import { SystemPage } from './pages/SystemPage';
import { AccessPage } from './pages/AccessPage';
import { LegalPage } from './pages/LegalPage';
import { JobLegalPage } from './pages/JobLegalPage';
import { MotionClipsPage } from './pages/MotionClipsPage';
import { GrowthPage } from './pages/GrowthPage';
import { CapturePage } from './pages/CapturePage';
import { AiPage } from './pages/AiPage';
import { ContactsPage } from './pages/ContactsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignBuilderPage } from './pages/CampaignBuilderPage';
import { RequireInternal } from './components/RequireInternal';
import { ComputerPracticePage } from './pages/ComputerPracticePage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireStaff>
                <Shell />
              </RequireStaff>
            }
          >
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="north-star" element={<NorthStarPage />} />
            <Route path="growth" element={<GrowthPage />} />
            <Route path="capture" element={<CapturePage />} />
            <Route path="ai" element={<AiPage />} />
            <Route path="contacts" element={<RequireInternal><ContactsPage /></RequireInternal>} />
            <Route path="campaigns" element={<RequireInternal><CampaignsPage /></RequireInternal>} />
            <Route path="campaigns/new" element={<RequireInternal><CampaignBuilderPage /></RequireInternal>} />
            <Route path="campaigns/:id" element={<RequireInternal><CampaignBuilderPage /></RequireInternal>} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:orgId" element={<AccountDetailPage />} />
            <Route path="access" element={<AccessPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="experiments" element={<ExperimentsPage />} />
            <Route path="metering" element={<MeteringPage />} />
            <Route path="ai-budgets" element={<AiBudgetsPage />} />
            <Route path="token-usage" element={<TokenUsagePage />} />
            <Route path="ai-reconciliation" element={<RequireInternal><AiReconciliationPage /></RequireInternal>} />
            <Route path="legal" element={<LegalPage />} />
            <Route path="motion-clips" element={<MotionClipsPage />} />
            <Route path="legal/jobs/:jobId" element={<JobLegalPage />} />
            <Route path="system" element={<SystemPage />} />
            <Route path="computer-practice" element={<RequireInternal><ComputerPracticePage /></RequireInternal>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
