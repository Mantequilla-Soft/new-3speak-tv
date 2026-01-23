import React, { useEffect, useState } from 'react';
import { Shield, Users, Zap, HelpCircle, ChevronDown, Video, MessageCircle, Facebook, Twitter,    } from 'lucide-react';
import './AboutPage.scss';
import speak from "../../assets/image/3speak.png"
import { FaDiscord } from "react-icons/fa6";
import { FaTelegramPlane } from "react-icons/fa";
import spk_network from "../../assets/image/spk_network.png"
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import hive from "../../assets/image/hive-1.jpeg"
const AboutPage = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const {   user,  } = useAppStore();
  const navigate = useNavigate()

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const iflogin = ()=>{
    
    if(user){
      navigate("/")
    }else{
      navigate("/login")
    }
  }

  const quotes = [
    {
      text: "If liberty means anything at all, it means the right to tell people what they do not want to hear.",
      author: "George Orwell"
    },
    {
      text: "I disapprove of what you say, but I will defend to the death your right to say it.",
      author: "Voltaire"
    },
    {
      text: "The right to free speech and the unrealistic expectation to never be offended can not coexist.",
      author: "Philip Sharp"
    },
    {
      text: "At no time is freedom of speech more precious than when a man hits his thumb with a hammer.",
      author: "Marshall Lumsden"
    },
    {
      text: "Freedom of speech means freedom for those who you despise, and freedom to express the most despicable views.",
      author: "Alan Dershowitz"
    },
    {
      text: "Ignorant free speech often works against the speaker. That is one of several reasons why it must be given rein instead of suppressed.",
      author: "Anna Quindlen"
    },
    {
      text: "Freedom of speech includes the freedom to offend people.",
      author: "Brad Thor"
    },
    {
      text: "There is a fine line between free speech and hate speech. Free speech encourages debate whereas hate speech incites violence.",
      author: "Newton Lee"
    },
    {
      text: "Freedom of speech means that you shall not do something to people either for the views they have, or the views they express, or the words they speak or write.",
      author: "Hugo L. Black"
    }
  ];

  const faqs = [
    {
      question: "What is 3Speak?",
      answer: "3Speak is a place where content creators directly own their onsite assets and their communities. Using blockchain technology, the ownership of these assets and communities are intrinsic to the creator and the user, not 3 Speak. They are therefore transferable to other apps that use blockchain technology. This means that if we do not serve the community and creators in the best possible way, they can take the assets they have generated and move them to another app. The result is that 3Speak is censorship resistant, cannot take your assets away or delete your communities."
    },
    {
      question: "Why am I not upvoted by 3Speak?",
      answer: "3Speak will vote at our own discretion and do not follow any specific criteria. The best way to attract our attention is to upload high-quality content and draw audiences and communities to 3speak."
    },
    {
      question: "Why are some of my videos missing from the new feed?",
      answer: "We allow you to upload as many videos as you want! This means that sometimes one user could fill up feeds with just their content, to combat this, we limit the videos by any one creator that can be displayed per load."
    },
    {
      question: "How do I become a content creator?",
      answer: "The quickest way to get a hive account is to press the \"Sign up\" button in the navigation panel and follow the instructions. (don't lose your keys!). Next you will need to log in with your hive account and click on the \"creator studio\" / upload. You're all set up and ready to go!"
    },
    {
      question: "How do I earn rewards for commenting?",
      answer: "In order to earn rewards, you need a Hive blockchain account. You can get one for free from Hive (https://signup.hive.io), purchase a Hive user guide, or get another Hive user to give you one. Once you have an account, login with Hivesigner and provide your ACTIVE key on first login. Then you can post comments which can earn cryptocurrency rewards."
    }
  ];

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className={`hero-content ${isVisible ? 'visible' : ''}`}>
          <h1 className="main-title">
            <span className="brand-name">3SPEAK</span>
            <span className="tagline">PROTECT YOUR CONTENT</span>
            <span className="tagline">TOKENISE YOUR COMMUNITY</span>
          </h1>
          <p className="description">
            {/* 3Speak is a place where content creators directly own their onsite assets and their communities. 
            Using blockchain technology, the ownership of these assets and communities are intrinsic to the 
            creator and the user, not 3 Speak. */}

            3Speak is built on the Hive blockchain, ensuring true decentralization, censorship resistance, and community ownership.
          </p>
          <button onClick={iflogin} className="cta-button">
            Join the Revolution
          </button>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="section dark-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">How 3Speak Works</h2>
            <p className="section-subtitle">
              Experience true content ownership through blockchain technology
            </p>
          </div>
          <div className="grid grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Video className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">Create Content</h3>
              <p className="feature-description">Upload your videos and create content that truly belongs to you on the blockchain.</p>
            </div>
            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <img 
                    src={speak}
                    alt="3Speak Logo" 
                  />
                </div>
              </div>
              <h3 className="feature-title blue-text">Earn Rewards</h3>
              <p className="feature-description">Get rewarded in Hive tokens and receive donations in our proprietary Speak token.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Users className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">Build Community</h3>
              <p className="feature-description">Create your own tokens, marketplaces, and economies to back your communities.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section dark-bg">
        <h1 className="feature-title-ns red-text">Features</h1>
        <div className="container-ab">
          <div className="grid grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Zap className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">REWARDS</h3>
              <p className="feature-description">
                By using the platform, users get rewarded in Hive tokens and can receive donations 
                in our proprietary Speak token. The more of these tokens you hold, the more privileges 
                you have in the eco system.
              </p>
            </div>

            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <Users className="text-blue-400" />
                </div>
              </div>
              <h3 className="feature-title blue-text">P2P</h3>
              <p className="feature-description">
                The blockchain technology that the site uses ensures that content creators have 
                true P2P connections to their user base, without any middle parties.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <img 
                    src={speak}
                    alt="3Speak Logo" 
                  />
                </div>
              </div>
              <h3 className="feature-title red-text">TOKENISATION</h3>
              <p className="feature-description">
                Content creators can also easily create their own tokens, market places, 
                stake driven rewards and economies to back their communities.
              </p>
            </div>

            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <Shield className="text-blue-400" />
                </div>
              </div>
              <h3 className="feature-title blue-text">FREE SPEECH</h3>
              <p className="feature-description">
                Our policy is that the ability to be offensive is the bedrock of Freedom of Speech, 
                and in turn Freedom of Speech protects societies from descending into chaos and civil war.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <MessageCircle className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">CITIZEN JOURNALISM</h3>
              <p className="feature-description">
                We encourage citizen journalists to join us and post the kind of content which is 
                often ignored. We believe that citizen journalists are the future.
              </p>
            </div>
          </div>
        </div>
      </section>

      

      {/* Powered by Hive Section */}
      <section className="section dark-bg hive-section">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">Powered by Hive Blockchain</h2>
          </div>
          <div className="hive-logo-container-ab">
            <div className="logo-box">
              <div className="logo-content">
                <img 
                  src={speak}
                  alt="3Speak Logo" 
                />
                <div className="times-symbol">×</div>
                <div className="hive-logo">
                  {/* <span>H</span> */}
                  <img src={hive} alt="" />
                </div>
              </div>
            </div>
          </div>
          <p className="section-subtitle-ns">
            3Speak is built on the Hive blockchain, ensuring true decentralization, censorship resistance, 
            and community ownership. The Hive ecosystem provides the infrastructure for rewards, governance, 
            and asset ownership that makes 3Speak revolutionary.
          </p>
          <div className="grid grid-3">
            <div className="feature-card">
              <h3 className="feature-title red-text">Decentralized</h3>
              <p className="feature-description">No single point of failure or control</p>
            </div>
            <div className="feature-card blue-accent">
              <h3 className="feature-title blue-text">Fast & Free</h3>
              <p className="feature-description">Zero transaction fees and 3-second blocks</p>
            </div>
            <div className="feature-card">
              <h3 className="feature-title red-text">Community Owned</h3>
              <p className="feature-description">Governed by stakeholders, not corporations</p>
            </div>
          </div>
        </div>
      </section>

      {/* Guidelines Section */}
      <section className="section darker-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">Our Guidelines</h2>
            <p className="section-subtitle">
              We believe Freedom of Speech is absolute, with clear and fair policies
            </p>
          </div>
          <div className="guidelines-grid">
            <div className="guideline-card">
              <h3 className="guideline-title red-text">What We Support</h3>
              <ul className="guideline-list">
                <li>Criticising religion, beliefs, groups, and people</li>
                <li>Alternative politics and conspiracy discussions</li>
                <li>Criticizing governments and world leaders</li>
                <li>Using pseudonyms for privacy</li>
                <li>Offensive jokes (when clearly marked as such)</li>
              </ul>
            </div>
            <div className="guideline-card blue-border">
              <h3 className="guideline-title blue-text">What We Restrict</h3>
              <ul className="guideline-list">
                <li className="blue-bullet">Calling for or incitement to violence</li>
                <li className="blue-bullet">Showing excessive gore or pornographic content</li>
                <li className="blue-bullet">Slander and defamatory content</li>
                <li className="blue-bullet">Illegal activities or content</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="section dark-bg">
        <div className="faq-container-ab">
          <div className="section-header">
            <h2 className="section-title">Frequently Asked Questions</h2>
            <p className="section-subtitle">
              Everything you need to know about 3Speak
            </p>
          </div>
          <div>
            {faqs.map((faq, index) => (
              <div key={index} className="faq-item">
                <button
                  onClick={() => toggleFaq(index)}
                  className="faq-button"
                >
                  <h3 className="faq-question">{faq.question}</h3>
                  <ChevronDown 
                    size={24} 
                    className={`faq-icon ${openFaq === index ? 'rotated' : ''}`}
                  />
                </button>
                {openFaq === index && (
                  <div className="faq-answer">
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quotes Section */}
      <section className="section darker-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">Voices of Freedom</h2>
          </div>
          <div className="quotes-grid">
            {quotes.map((quote, index) => (
              <div key={index} className="quote-card">
                <blockquote className="quote-text">
                  "{quote.text}"
                </blockquote>
                <cite className="quote-author">
                  — {quote.author}
                </cite>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="section gradient-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">Ready to Own Your Content?</h2>
            <p className="section-subtitle">
              Join thousands of creators who have already taken control of their digital assets.
            </p>
            {/* <button className="cta-button">
              Get Started Today
            </button> */}
          </div>
          
          <div style={{ borderTop: '1px solid #374151', paddingTop: '2rem', marginTop: '3rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'white', marginBottom: '1.5rem', textAlign: 'center' }}>
              Connect with 3Speak
            </h3>
            <div className="social-icons">
              {/* <a href="https://x.com/3speaktv?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer">
                <Facebook />
              </a> */}
              <a href="https://t.me/threespeak?utm_source=3speak.tv" className="social-link red-accent" target="_blank" rel="noopener noreferrer">
                <FaTelegramPlane />
              </a>
              <a href="https://discord.com/invite/NSFS2VGj83" className="social-link" target="_blank" rel="noopener noreferrer">
                <FaDiscord size={30} />
              </a>
              <a href="https://x.com/3speaktv?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer">
                <Twitter />
              </a>
              <a href="https://spk.network/" className="social-link red-accent spk" target="_blank" rel="noopener noreferrer">
                <img src={spk_network} alt="" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;