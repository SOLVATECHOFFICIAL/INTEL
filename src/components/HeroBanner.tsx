import React from 'react';
import { ArrowRight } from 'lucide-react';
import { BRAND } from '../config/brand';
import { ActiveRoute } from '../types/platform';
import { BrandLogo } from './BrandLogo';

interface HeroBannerProps {
  onNavigate: (route: ActiveRoute) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ onNavigate }) => {
  return (
    <section
      aria-labelledby="hero-heading"
      className="border-b border-slate-200 bg-[#0B1A2E] text-white"
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3.5">
              <BrandLogo size="lg" showWordmark={false} inverted />
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#1E88E5]">
                  Student Technology Platform
                </p>
                <p className="font-display text-sm font-semibold text-slate-200">
                  {BRAND.name}
                </p>
              </div>
            </div>

            <h1
              id="hero-heading"
              className="mt-5 font-display text-3xl font-extrabold tracking-tight text-white [text-wrap:balance] sm:text-4xl lg:text-[44px] lg:leading-[1.12]"
            >
              {BRAND.tagline}
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">
              A unified university platform structured for verified campus
              updates, student discussions, marketplace discovery, peer circles,
              opportunities, and campus events.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('for-you')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white whitespace-nowrap transition-colors duration-150 hover:bg-[#1565C0]"
              >
                Open For You
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>

              <a
                href="#platform-sections"
                className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-slate-200 underline-offset-4 hover:text-white hover:underline"
              >
                Explore all 8 sections
              </a>
            </div>
          </div>

          <div className="space-y-4 border-t border-white/10 pt-6 lg:w-80 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#1E88E5]">
                Campus Streams
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-200">
                For You · Following · Latest · Anonymous
              </p>
            </div>
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs font-semibold tracking-wide text-[#1E88E5]">
                Campus Hub
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-200">
                Marketplace · Trusted Circle · Opportunities · Upcoming Events
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
