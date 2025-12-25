import React, { useEffect, useState } from 'react';
import { Client } from '@hiveio/dhive';
import SkeletonLoader from './SkeletonLoader';
import './CommunitiesRender.scss';
import { Link, useNavigate } from 'react-router-dom';
import CreateCommunity from '../modal/CreateCommunity';

const client = new Client([
  'https://api.hive.blog',
  'https://api.openhive.network'
]);

function CommunitiesRender() {
  const [data, setData] = useState([]); // All communities data
  const [filteredData, setFilteredData] = useState([]); // Filtered communities based on search
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(''); // Search query state
  const [openModal, setOpenModal] = useState(false)
  const navigate = useNavigate();
  console.log(openModal)

  // Fetch communities data
  const generate = async () => {
    setLoading(true);
    try {
      const res = await client.call('bridge', 'list_communities', {
        last: '',
        limit: 100,
        observer: ''
      });
      setData(res);
      setFilteredData(res); // Initialize filteredData with all data     
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };
  console.log(data)

  // Handle search input change
  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);

    // Filter communities based on the search query
    const filtered = data.filter((community) =>
      community.title.toLowerCase().includes(query)
    );
    setFilteredData(filtered);
  };

  useEffect(() => {
    document.title = '3Speak - Tokenised video communities';
    generate();
  }, []);
  const handleCardClick = (communityName) => {
    navigate(`/community/${communityName}`);
  };

  const toggleModal = ()=>{
    setOpenModal( (prev)=> !prev)
  }


  return (
    <>
    <div className="communities-render">
      <div className="create-communitie-wrap">
        <h1 >Communities – Best online, decentralized, immutable, rewarding communities</h1>
        <h1 className='phone-c'>Communities</h1>
        <button onClick={toggleModal}>Create Community</button>
      </div>

      {/* Search Input */}
      <div className="search-wrapper">
        <input
          type="text"
          placeholder="Search communities..."
          value={searchQuery}
          onChange={handleSearch}
        />
      </div>

      {/* Skeleton Loader or Blog Feed */}
      {loading ? (
        <SkeletonLoader />
      ) : (
        <div className="blog-feed">
          {filteredData?.map((community, index) => (
            <div key={index} className="blog-card" onClick={() => handleCardClick(community.name)}>
              <div className="img-wrap">
                <img
                  src={
                    'https://images.hive.blog/u/' + community.name + '/avatar?size=icon'
                  }
                  alt={community.title}
                  className="blog-image"
                />
              </div>
              <h3 className="blog-title">{community.title}</h3>
            </div>
          ))}
        </div>
      )}
    </div>
    {openModal && <CreateCommunity close={toggleModal} isOpen={openModal} /> }
    </>
  );
}

export default CommunitiesRender;
