import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import './Auth.css';

// Local shape mirrors the backend's user projection (see backend/openapi.yaml
// GetUserResponse). Kept inline so this page has zero API dependencies today —
// swap for a real fetch when the backend is wired up.
interface StaticProfile {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
}

const STATIC_PROFILE: StaticProfile = {
  email: 'maria.mueller@example.de',
  vorname: 'Maria',
  nachname: 'Müller',
  telefon: '+49 151 23456789',
  adresse: {
    strasse: 'Hauptstraße',
    hausnr: '42',
    plz: '68159',
    ort: 'Mannheim',
    land: 'DE',
  },
};

const STATIC_BANK = {
  iban: 'DE89 3704 0044 0532 0130 00',
  bic: 'COBADEFFXXX',
};

/**
 * Static profile page. No API calls, no data-loading state, no error handling.
 * Edit buttons flip local state so the inline edit forms render, but "Speichern"
 * simply closes the editor — nothing is persisted. Delete-account also does
 * nothing beyond the confirm dialog. Real wiring will replace `STATIC_PROFILE`
 * with a fetch to `GET /users/me` + `GET /users/me/refund-data`.
 */
export const ProfilePage = () => {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<StaticProfile>(STATIC_PROFILE);
  const [bankData, setBankData] = useState(STATIC_BANK);

  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSavePersonal = () => {
    // Static: no backend call. Local state already reflects the user's edits.
    setEditingPersonal(false);
  };

  const handleSaveBank = () => {
    setEditingBank(false);
  };

  const handleDeleteAccount = () => {
    // Static: just log the user out and bounce home.
    logout();
    navigate('/');
  };

  return (
    <div className="profile-page">
      <Header />
      <main className="profile-container">
        <h1 className="h1">{t.auth.profile.title}</h1>

        <Card className="profile-section">
          <div className="section-header">
            <h2 className="h2">{t.auth.profile.personalTitle}</h2>
            {!editingPersonal && (
              <Button variant="secondary" onClick={() => setEditingPersonal(true)}>
                {t.auth.profile.edit}
              </Button>
            )}
          </div>
          {editingPersonal ? (
            <>
              <Input
                label={t.auth.register.vorname}
                value={profile.vorname}
                onChange={(e) => setProfile({ ...profile, vorname: e.target.value })}
              />
              <Input
                label={t.auth.register.nachname}
                value={profile.nachname}
                onChange={(e) => setProfile({ ...profile, nachname: e.target.value })}
              />
              <Input
                label={t.auth.register.telefon}
                value={profile.telefon}
                onChange={(e) => setProfile({ ...profile, telefon: e.target.value })}
              />
              <Input
                label={t.auth.register.strasse}
                value={profile.adresse.strasse}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, strasse: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.hausnr}
                value={profile.adresse.hausnr}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, hausnr: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.plz}
                value={profile.adresse.plz}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, plz: e.target.value },
                  })
                }
              />
              <Input
                label={t.auth.register.ort}
                value={profile.adresse.ort}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    adresse: { ...profile.adresse, ort: e.target.value },
                  })
                }
              />
              <div className="button-group">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingPersonal(false);
                    setProfile(STATIC_PROFILE);
                  }}
                >
                  {t.auth.profile.cancel}
                </Button>
                <Button variant="primary" onClick={handleSavePersonal}>
                  {t.auth.profile.save}
                </Button>
              </div>
            </>
          ) : (
            <div className="profile-data">
              <p>
                <strong>{t.auth.register.vorname}:</strong> {profile.vorname}
              </p>
              <p>
                <strong>{t.auth.register.nachname}:</strong> {profile.nachname}
              </p>
              <p>
                <strong>{t.auth.register.email}:</strong> {profile.email}
              </p>
              <p>
                <strong>{t.auth.register.telefon}:</strong> {profile.telefon}
              </p>
              <p>
                <strong>{t.auth.register.strasse}:</strong> {profile.adresse.strasse}{' '}
                {profile.adresse.hausnr}
              </p>
              <p>
                <strong>
                  {t.auth.register.plz} {t.auth.register.ort}:
                </strong>{' '}
                {profile.adresse.plz} {profile.adresse.ort}
              </p>
            </div>
          )}
        </Card>

        <Card className="profile-section">
          <div className="section-header">
            <h2 className="h2">{t.auth.profile.bankTitle}</h2>
            {!editingBank && (
              <Button variant="secondary" onClick={() => setEditingBank(true)}>
                {t.auth.profile.edit}
              </Button>
            )}
          </div>
          {editingBank ? (
            <>
              <Input
                label={t.auth.register.iban}
                value={bankData.iban}
                onChange={(e) => setBankData({ ...bankData, iban: e.target.value })}
              />
              <Input
                label={t.auth.register.bic}
                value={bankData.bic}
                onChange={(e) => setBankData({ ...bankData, bic: e.target.value })}
              />
              <div className="button-group">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingBank(false);
                    setBankData(STATIC_BANK);
                  }}
                >
                  {t.auth.profile.cancel}
                </Button>
                <Button variant="primary" onClick={handleSaveBank}>
                  {t.auth.profile.save}
                </Button>
              </div>
            </>
          ) : (
            <div className="profile-data">
              <p>
                <strong>{t.auth.register.iban}:</strong> {bankData.iban}
              </p>
              <p>
                <strong>{t.auth.register.bic}:</strong> {bankData.bic}
              </p>
            </div>
          )}
        </Card>

        <Card className="profile-section">
          <h2 className="h2">{t.auth.profile.accountTitle}</h2>
          {!showDeleteConfirm ? (
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(true)}>
              {t.auth.profile.deleteAccount}
            </Button>
          ) : (
            <>
              <p>{t.auth.profile.deleteConfirm}</p>
              <Input
                label={t.auth.profile.confirmPassword}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <div className="button-group">
                <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
                  {t.auth.profile.cancel}
                </Button>
                <Button variant="primary" onClick={handleDeleteAccount}>
                  {t.auth.profile.deleteAccount}
                </Button>
              </div>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
};
