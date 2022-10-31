import React, {Component} from 'react';
import axios from 'axios'

class AuthorizeSpotify extends Component{
    
    refreshToken = async () => {
        var clientId = '124f4f096f4b44609792a00f19f8379c'; // Your client id
        var clientSecret = '1790b63eedce4876a2a5f8673f917380'; // Your secret
        
        // your application requests authorization
        var authOptions = {
          url: 'https://accounts.spotify.com/api/token',
          headers: {
            'Authorization': {
                client_id : clientId,
                client_secret: clientSecret
            }
          },
          form: {
            grant_type: 'authorization_code'
          },
          json: true
        };

        const response = await axios.post(
            authOptions
        )
        console.log(response)
        
        
        /*request.post(authOptions, function(error, response, body) {
          if (!error && response.statusCode === 200) {
        
            // use the access token to access the Spotify Web API
            var token = body.access_token;
            var options = {
              url: 'https://api.spotify.com/v1/users/jmperezperez',
              headers: {
                'Authorization': 'Bearer ' + token
              },
              json: true
            };
            request.get(options, function(error, response, body) {
              console.log(body);
            });
          }
        });
        */
        
    }

    render() {
        return (
            <div>
                <button onClick={this.refreshToken}>Refresh Token</button>
            </div>
        )
    }
}

export default AuthorizeSpotify;