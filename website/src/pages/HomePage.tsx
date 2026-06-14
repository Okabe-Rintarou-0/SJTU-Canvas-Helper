import Navbar from "../components/Navbar"
import HeroSection from "../components/HeroSection"
import FeaturesSection from "../components/FeaturesSection"
import PreviewSection from "../components/PreviewSection"
import JBoxSection from "../components/JBoxSection"
import FooterSection from "../components/FooterSection"

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <FeaturesSection />
        <PreviewSection />
        <JBoxSection />
      </main>
      <FooterSection />
    </>
  )
}
