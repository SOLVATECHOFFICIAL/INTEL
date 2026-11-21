import React from 'react';
import {
  ArrowRight,
  Building2,
  ShoppingBag,
  Users,
  Wrench,
} from 'lucide-react';
import { CampusSection } from '../types/campus';

interface CategoryGridProps {
  onSelectCategory: (section: CampusSection) => void;
}

const CATEGORIES: {
  id: Exclude<CampusSection, 'home'>;
  title: string;
  description: string;
  iconBg: string;
  iconColor: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  {
    id: 'marketplace',
    title: 'Marketplace',
    description:
      'Textbooks, electronics, dorm essentials, and everyday items from students near you.',
    iconBg: 'bg-blue-50',
    iconColor: 'text-[#0066FF]',
    Icon: ShoppingBag,
  },
  {
    id: 'services',
    title: 'Services',
    description:
      'Tutoring, graphic design, laundry, catering, hairstyling, and device repairs on campus.',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-500',
    Icon: Wrench,
  },
  {
    id: 'accommodation',
    title: 'Accommodation',
    description:
      'Browse verified off-campus lodges, self-contained rooms, and hostels around Epe.',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    Icon: Building2,
  },
  {
    id: 'roommates',
    title: 'Roommates',
    description:
      'Connect with compatible LASUED and LASU students looking to share accommodation.',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-500',
    Icon: Users,
  },
];

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  onSelectCategory,
}) => {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12 pb-6 sm:px-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Browse by Category
        </h2>
        <p className="mt-1 text-sm text-slate-500 sm:text-[15px]">
          Everything students need across campus life in one place.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map((category) => {
          const { Icon } = category;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className="group flex flex-col items-start rounded-2xl border border-slate-200/90 bg-white p-6 text-left shadow-2xs transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-xl ${category.iconBg} ${category.iconColor}`}
              >
                <Icon className="h-5 w-5" />
              </div>

              <div className="mt-5 flex w-full items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">
                  {category.title}
                </h3>
                <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0066FF]" />
              </div>

              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {category.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
};
