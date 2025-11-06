import React from "react";
import "./NotFound.scss"
import image from "../assets/image/404.png";

function NotFound() {
    
  return (
    <div className="not-found-container">
      <img src={image} alt="404" />
      <p>SORRY! PAGE NOT FOUND</p>
      <h3>Unfortunately, the page you are looking for is not available.</h3>
      <button>GO TO HOME PAGE</button>
    </div>
  );
}

export default NotFound;
