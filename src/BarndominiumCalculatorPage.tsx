import { ArrowUpRight, Calculator, CheckCircle2, Home, ShieldCheck } from "lucide-react";

const calculatorUrl = "https://viper-steel-barndominium-calculator.vipersteel-7138.chatgpt.site/";

export function BarndominiumCalculatorPage() {
  return (
    <section className="viper-calculator-page">
      <header className="viper-calculator-hero">
        <div>
          <span className="viper-eyebrow"><Calculator size={16} /> Viper Steel</span>
          <h1>Barndominium Cost Calculator</h1>
          <p>Build a preliminary estimate with your client, one clear decision at a time.</p>
        </div>
        <a className="button button-primary viper-launch" href={calculatorUrl} target="_blank" rel="noreferrer">
          Open calculator <ArrowUpRight size={18} />
        </a>
      </header>

      <div className="viper-calculator-grid">
        <article className="viper-card viper-card-featured">
          <span className="viper-icon"><Home size={25} /></span>
          <h2>Start a new barndominium estimate</h2>
          <p>Capture client and project details, select finishes, and prepare a polished preliminary estimate for review.</p>
          <a className="button button-primary" href={calculatorUrl} target="_blank" rel="noreferrer">
            Launch Viper Steel Calculator <ArrowUpRight size={18} />
          </a>
        </article>
        <article className="viper-card">
          <span className="viper-icon viper-icon-soft"><CheckCircle2 size={25} /></span>
          <h2>Guided client experience</h2>
          <ul>
            <li>Project, building, concrete, utilities, exterior, and interior selections</li>
            <li>Visual Bronze, Silver, and Gold finish examples</li>
            <li>Clean review screen before the estimate is generated</li>
          </ul>
        </article>
        <article className="viper-card">
          <span className="viper-icon viper-icon-dark"><ShieldCheck size={25} /></span>
          <h2>Pricing stays protected</h2>
          <p>The calculator presents client-ready estimates while keeping internal costs, margins, and pricing formulas out of the client experience.</p>
        </article>
      </div>
      <aside className="viper-note"><strong>Sales tip</strong><span>Open the calculator in a new tab before a client consultation so the portal remains available for project records and follow-up.</span></aside>
    </section>
  );
}
