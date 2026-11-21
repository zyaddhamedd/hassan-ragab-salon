import React from 'react';
import { Cashier } from '../App';
import BranchInventoryScreen from './BranchInventoryScreen';

interface StorageScreenProps {
  cashier: Cashier;
}

const StorageScreen: React.FC<StorageScreenProps> = ({ cashier }) => {
  return <BranchInventoryScreen cashier={cashier} />;
};

export default StorageScreen;
