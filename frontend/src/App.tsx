import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './lib/LanguageContext';
import { AuthProvider } from './lib/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { CampaignLandingPage1 } from './pages/CampaignLandingPage1';
import { TicketErstattungPage } from './pages/campaigns/TicketErstattungPage';
import { DeutschlandticketErstattungPage } from './pages/campaigns/DeutschlandticketErstattungPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { ClaimDetailPage } from './pages/ClaimDetailPage';
import { FAQPage } from './pages/FAQPage';
import { LegalPage } from './pages/LegalPage';
import { PricingPage } from './pages/PricingPage';
import { AdminApp } from './pages/admin/AdminApp';
import { WizardProvider } from './pages/wizard/WizardContext';
import { EntryStep } from './pages/wizard/EntryStep';
import { UploadStep } from './pages/wizard/UploadStep';
import { LookupStep } from './pages/wizard/LookupStep';
import { FahrtStep } from './pages/wizard/FahrtStep';
import { ProblemStep } from './pages/wizard/ProblemStep';
import { PersonStep } from './pages/wizard/PersonStep';
import { AuszahlungStep } from './pages/wizard/AuszahlungStep';
import { ReviewStep } from './pages/wizard/ReviewStep';
import { SubmittedStep } from './pages/wizard/SubmittedStep';

/**
 * Wraps every wizard route in a single WizardProvider so state persists across
 * step navigations. Kept as a small component so App's route table stays flat.
 */
const WizardRoutes = () => (
  <WizardProvider>
    <Routes>
      <Route index element={<EntryStep />} />
      <Route path="upload" element={<UploadStep />} />
      <Route path="suche" element={<LookupStep />} />
      <Route path="reise" element={<FahrtStep />} />
      <Route path="problem" element={<ProblemStep />} />
      <Route path="person" element={<PersonStep />} />
      <Route path="auszahlung" element={<AuszahlungStep />} />
      <Route path="pruefen" element={<ReviewStep />} />
      <Route path="eingereicht" element={<SubmittedStep />} />
      <Route path="*" element={<Navigate to="/antrag/neu" replace />} />
    </Routes>
  </WizardProvider>
);

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/campaign-landing-page-1" element={<CampaignLandingPage1 />} />
            {/* Marketing campaign landing pages — see src/pages/campaigns. */}
            <Route path="/ticket-erstattung" element={<TicketErstattungPage />} />
            <Route path="/deutschlandticket-erstattung" element={<DeutschlandticketErstattungPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/preise" element={<PricingPage />} />
            <Route path="/impressum" element={<LegalPage type="impressum" />} />
            <Route path="/rechtliches" element={<LegalPage type="rechtliches" />} />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            {/* Wizard tree — must come BEFORE /antrag/:ticketId so the literal
                'neu' segment doesn't get eaten by the param route. */}
            <Route
              path="/antrag/neu/*"
              element={
                <ProtectedRoute>
                  <WizardRoutes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/antrag/:ticketId"
              element={
                <ProtectedRoute>
                  <ClaimDetailPage />
                </ProtectedRoute>
              }
            />
            {/* Backwards-compat: old /user link redirects into the wizard. */}
            <Route path="/user" element={<Navigate to="/antrag/neu" replace />} />
            {/* Admin panel has its own AdminGuard + session-scoped token store;
                it does not use the marketing AuthProvider. */}
            <Route path="/admin-panel/*" element={<AdminApp />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
