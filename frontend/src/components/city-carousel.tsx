// src/components/CityCarousel.tsx
'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

// Mock data representing listing destinations and cities.
const locations = [
  { id: 1, name: 'Houston', img: '/400x400_Placeholder_Image.png'},
  { id: 2, name: 'Austin', img: '/400x400_Placeholder_Image.png'},
  { id: 3, name: 'Dallas', img: '/400x400_Placeholder_Image.png'},
  { id: 4, name: 'New York', img: '/400x400_Placeholder_Image.png'},
  { id: 5, name: 'Miami', img: '/400x400_Placeholder_Image.png'},
];

export default function CityCarousel() {
  const router = useRouter();

  // Unified click handler for both the image card and the text links
  const handleLocationSearch = (cityName: string) => {
    router.push(`/search?location=${encodeURIComponent(cityName)}`);
  };

  return (
    /* opts={{ align: "start" }} tells the carousel to anchor items to the left margin */
    <Carousel opts={{ align: "start" }} className="w-full max-w-5xl mt-12 mx-auto px-4">
      <CarouselContent>
        {locations.map((city) => (
          /* Responsive width sizing:
             - basis-full: 1 slide per view on mobile
             - sm:basis-1/2: 2 slides per view on small screens
             - md:basis-1/3: 3 slides per view on desktop
          */
          <CarouselItem key={city.id} className="sm:basis-1/2 md:basis-1/3 p-4">
            <div className="flex flex-col gap-4 group">
              
              {/* Interactive Image Bracket Card */}
              <div 
                onClick={() => handleLocationSearch(city.name)}
                className="relative h-64 w-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-md"
              >
                {/* Fallback layout background if an image is missing during wireframing */}
                <div className="absolute inset-0 bg-slate-200 animate-pulse" />
                <Image
                  src={city.img}
                  alt={`Explore listings in ${city.name}`}
                  fill
                  sizes="(max-w-768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>

              {/* Text Labels & Context Links */}
              <div className="flex flex-col items-start px-1">
                <h3 className="font-bold text-2xl text-black tracking-tight">
                  {city.name}
                </h3>
                
                {/* Navigation Hyperlink */}
                <button
                  onClick={() => handleLocationSearch(city.name)}
                  className="mt-3 text-lg font-semibold text-sky-700 hover:text-sky-950 transition-colors underline underline-offset-4"
                >
                  Explore {city.name} →
                </button>
              </div>

            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      
      {/* Navigation Arrow Hooks (Hidden on mobile touch screens, blocks on desktop hover structures) */}
      <CarouselPrevious className="hidden md:inline-flex -left-12 bg-white text-slate-800 border-slate-200 hover:bg-slate-50" />
      <CarouselNext className="hidden md:inline-flex -right-12 bg-white text-slate-800 border-slate-200 hover:bg-slate-50" />
    </Carousel>
  );
}