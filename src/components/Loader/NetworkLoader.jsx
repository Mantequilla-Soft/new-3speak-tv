import React from 'react'
import { useTranslation } from 'react-i18next';
import { WifiLoader } from "react-awesome-loaders";
import "./NetworkLoader.scss"

function NetworkLoader() {
  const { t } = useTranslation();
  return (
    <div className='networkloader-container'>
        <WifiLoader
        background={"transparent"}
        desktopSize={"150px"}
        mobileSize={"150px"}
        text={t('app.loaders.wifi')}
        // backColor="#E8F2FC"
        backColor="#FF0000"
        frontColor="#FF0000"
      />
    </div>
  )
}

// link for awesome loaders => https://awesome-loaders.netlify.app/docs/loaders/wifiloader/

export default NetworkLoader