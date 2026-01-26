import { initAioha} from '@aioha/aioha'

const aioha = initAioha({
  hiveauth: {
    name: 'Aioha',
    description: 'Aioha test app'
  },
  hivesigner: {
    app: 'ipfsuploader.app',
    callbackURL: window.location.origin + '/hivesigner.html',
    scope: ['login', 'vote']
  }
})

export default aioha;

