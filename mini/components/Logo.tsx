import React from 'react';
import logo from '../src/assets/logo.svg';

interface LogoProps {
    className?: string;
}

const Logo: React.FC<LogoProps> = ({ className = "w-full h-full" }) => {
    return (
        <img
            src={logo}
            alt="نادي الرجال السري"
            className={`object-contain ${className}`}
        />
    );
};

export default Logo;
