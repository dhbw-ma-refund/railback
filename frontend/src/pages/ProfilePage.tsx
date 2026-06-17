import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Button } from '@shared/components';
import { Input } from '@shared/components';
import { Card } from '@shared/components';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { api, UserProfile } from '../lib/api';
import './Auth.css';

export const ProfilePage = () => {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bankData, setBankData] = useState<{ iban: string | null; bic: string | null }>({
    iban: null,
    bic: null,
  });

  const [editingPersonal, setEditingPersonal] = useState(false);
  const [editingBank, setEditingBank] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const [profileData, refundData] = await Promise.all([
        api.getProfile(),
        api.getRefundData(),
      ]);
      setProfile(profileData);
      setBankData({ iban: refundData.iban, bic: refundData.bic });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSavePersonal = async () => {
    if (!profile) return;
    setError('');
    setSuccess('');
    try {
      await api.updateProfile({
        vorname: profile.vorname,
        nachname: profile.nachname,
        telefon: profile.telefon,
        adresse: profile.adresse,
      });
      setSuccess(t.auth.profile.updateSuccess);
      setEditingPersonal(false);
    } catch (err: any) {
      setError(err.message || t.auth.profile.updateError);
    }
  };

  const handleSaveBank = async () => {
    if (!bankData.iban || !bankData.bic) return;
    setError('');
    setSuccess('');
    try {
      await api.updateBank(bankData.iban, bankData.bic);
      setSuccess(t.auth.profile.updateSuccess);
      setEditingBank(false);
    } catch (err: any) {
      setError(err.message || t.auth.profile.updateError);
    }
  };

  const handleDeleteAccount = async () => {
    setError('');
    try {
      await api.deleteAccount(confirmPassword);
      logout();
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!profile) return <div>Loading...</div>;

  return (
    <div className="profile-page">
      <Header />
      <div className="profile-container">
        <h1 className="h1">{t.auth.profile.title}</h1>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

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
                    loadProfile();
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
                value={bankData.iban || ''}
                onChange={(e) => setBankData({ ...bankData, iban: e.target.value })}
              />
              <Input
                label={t.auth.register.bic}
                value={bankData.bic || ''}
                onChange={(e) => setBankData({ ...bankData, bic: e.target.value })}
              />
              <div className="button-group">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingBank(false);
                    loadProfile();
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
                <strong>{t.auth.register.iban}:</strong> {bankData.iban || 'Nicht angegeben'}
              </p>
              <p>
                <strong>{t.auth.register.bic}:</strong> {bankData.bic || 'Nicht angegeben'}
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
      </div>
      <Footer />
    </div>
  );
};
