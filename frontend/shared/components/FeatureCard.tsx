import React from 'react';
import { Card } from './Card';
import './FeatureCard.css';

export interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  accentColor?: string;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
  icon,
  title,
  description,
  accentColor
}) => {
  return (
    <Card className="feature-card">
      <div className="feature-card__icon" style={{ color: accentColor }}>
        {icon}
      </div>
      <h3 className="h3">{title}</h3>
      <p className="body">{description}</p>
    </Card>
  );
};
