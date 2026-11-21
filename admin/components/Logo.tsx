import React from 'react';
import logoUrl from '../assets/logo (1) (1).svg';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero' | 'super-hero';
}

const Logo: React.FC<LogoProps> = ({ className = '', size = 'md' }) => {
  const sizes = {
    sm: 'w-12 h-12',
    md: 'w-24 h-24',
    lg: 'w-36 h-36',
    xl: 'w-48 h-48',
    hero: 'w-64 h-64 sm:w-80 sm:h-80',
    'super-hero': 'w-80 h-80 sm:w-[400px] sm:h-[400px]',
  };

  return (
    <div className={`${sizes[size]} ${className} flex items-center justify-center relative`}>
      <img
        src={logoUrl}
        alt="The Secret Men Club Logo"
        className="w-full h-full object-contain"
      />
    </div>
  );
};

export default Logo;

