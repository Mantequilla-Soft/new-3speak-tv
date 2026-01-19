import React from "react";
import "./NotFound.scss"
import image from "../assets/image/404.png";
import { Link } from 'react-router-dom';

function NotFound() {
    
  return (
    <div className="not-found-container">
      <img src={image} alt="404" />
      <p>SORRY! PAGE NOT FOUND</p>
      <h3>Unfortunately, the page you are looking for is not available.</h3>
      <Link to="/">
        <button>GO TO HOME PAGE</button>
      </Link>
    </div>
  );
}

export default NotFound;
