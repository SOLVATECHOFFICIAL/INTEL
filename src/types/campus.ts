export type CampusSection =
  | 'home'
  | 'marketplace'
  | 'services'
  | 'accommodation'
  | 'roommates';

export type CampusZone =
  | 'LASUED Epe'
  | 'LASU Epe'
  | 'Noforija'
  | 'Odomola'
  | 'Epe Town';

export interface MarketplaceItem {
  id: string;
  kind: 'marketplace';
  title: string;
  price: number;
  category: 'Textbooks' | 'Electronics' | 'Dorm Essentials' | 'Fashion';
  condition: 'Brand New' | 'Neatly Used' | 'Fairly Used';
  campus: CampusZone;
  sellerName: string;
  sellerDept: string;
  verified: boolean;
  postedAt: string;
  description: string;
  imageBg: string;
  emoji: string;
}

export interface CampusService {
  id: string;
  kind: 'services';
  title: string;
  startingPrice: number;
  priceUnit: string;
  category:
    | 'Tutoring'
    | 'Graphic Design'
    | 'Laundry'
    | 'Catering'
    | 'Hairstyling'
    | 'Device Repairs';
  campus: CampusZone;
  providerName: string;
  rating: number;
  reviewsCount: number;
  verified: boolean;
  turnaround: string;
  description: string;
}

export interface AccommodationLodge {
  id: string;
  kind: 'accommodation';
  title: string;
  annualRent: number;
  lodgeType: 'Self-Contain' | 'Single Room' | 'Shared Hostel' | 'Mini Flat';
  campus: CampusZone;
  distanceToGate: string;
  amenities: string[];
  availableRooms: number;
  caretakerName: string;
  verified: boolean;
  description: string;
}

export interface RoommateProfile {
  id: string;
  kind: 'roommates';
  name: string;
  school: 'LASUED' | 'LASU';
  department: string;
  level: string;
  gender: 'Female' | 'Male';
  preferredArea: CampusZone;
  budgetPerYear: number;
  roomStatus: 'Has Room (Needs Roommate)' | 'Looking Together';
  habits: string[];
  bio: string;
  verified: boolean;
}

export type AnyListing =
  | MarketplaceItem
  | CampusService
  | AccommodationLodge
  | RoommateProfile;

export interface UserAccount {
  id: string;
  fullName: string;
  email: string;
  school: 'LASUED' | 'LASU' | 'Epe Community';
  department: string;
}
