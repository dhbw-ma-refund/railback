import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './lib/LanguageContext';
import { LandingPage } from './pages/LandingPage';
import { CampaignLandingPage1 } from './pages/CampaignLandingPage1';
import { UserForms } from './pages/UserForms';
import { FAQPage } from './pages/FAQPage';
import { LegalPage } from './pages/LegalPage';
import { PricingPage } from './pages/PricingPage';
import { AdminApp } from './pages/admin/AdminApp';

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/campaign-landing-page-1" element={<CampaignLandingPage1 />} />
          <Route path="/user" element={<UserForms />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/preise" element={<PricingPage />} />
          <Route path="/impressum" element={<LegalPage type="impressum" />} />
          <Route path="/rechtliches" element={<LegalPage type="rechtliches" />} />
          <Route path="/admin-panel/*" element={<AdminApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
