<<<<<<< HEAD
# Backend



## Getting started

To make it easy for you to get started with GitLab, here's a list of recommended next steps.

Already a pro? Just edit this README.md and make it your own. Want to make it easy? [Use the template at the bottom](#editing-this-readme)!

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/topics/git/add_files/#add-a-file-using-the-command-line) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin https://gitlab.com/web3-v01/backend.git
git branch -M main
git push -uf origin main
```

## Integrate with your tools

- [ ] [Set up project integrations](https://gitlab.com/web3-v01/backend/-/settings/integrations)

## Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Set auto-merge](https://docs.gitlab.com/user/project/merge_requests/auto_merge/)

## Test and Deploy

Use the built-in continuous integration in GitLab.

- [ ] [Get started with GitLab CI/CD](https://docs.gitlab.com/ee/ci/quick_start/)
- [ ] [Analyze your code for known vulnerabilities with Static Application Security Testing (SAST)](https://docs.gitlab.com/ee/user/application_security/sast/)
- [ ] [Deploy to Kubernetes, Amazon EC2, or Amazon ECS using Auto Deploy](https://docs.gitlab.com/ee/topics/autodevops/requirements.html)
- [ ] [Use pull-based deployments for improved Kubernetes management](https://docs.gitlab.com/ee/user/clusters/agent/)
- [ ] [Set up protected environments](https://docs.gitlab.com/ee/ci/environments/protected_environments.html)

***

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thanks to [makeareadme.com](https://www.makeareadme.com/) for this template.

## Suggestions for a good README

Every project is different, so consider which of these sections apply to yours. The sections used in the template are suggestions for most open source projects. Also keep in mind that while a README can be too long and detailed, too long is better than too short. If you think your README is too long, consider utilizing another form of documentation rather than cutting out information.

## Name
Choose a self-explaining name for your project.

## Description
Let people know what your project can do specifically. Provide context and add a link to any reference visitors might be unfamiliar with. A list of Features or a Background subsection can also be added here. If there are alternatives to your project, this is a good place to list differentiating factors.

## Badges
On some READMEs, you may see small images that convey metadata, such as whether or not all the tests are passing for the project. You can use Shields to add some to your README. Many services also have instructions for adding a badge.

## Visuals
Depending on what you are making, it can be a good idea to include screenshots or even a video (you'll frequently see GIFs rather than actual videos). Tools like ttygif can help, but check out Asciinema for a more sophisticated method.

## Installation
Within a particular ecosystem, there may be a common way of installing things, such as using Yarn, NuGet, or Homebrew. However, consider the possibility that whoever is reading your README is a novice and would like more guidance. Listing specific steps helps remove ambiguity and gets people to using your project as quickly as possible. If it only runs in a specific context like a particular programming language version or operating system or has dependencies that have to be installed manually, also add a Requirements subsection.

## Usage
Use examples liberally, and show the expected output if you can. It's helpful to have inline the smallest example of usage that you can demonstrate, while providing links to more sophisticated examples if they are too long to reasonably include in the README.

## Support
Tell people where they can go to for help. It can be any combination of an issue tracker, a chat room, an email address, etc.

## Roadmap
If you have ideas for releases in the future, it is a good idea to list them in the README.

## Contributing
State if you are open to contributions and what your requirements are for accepting them.

For people who want to make changes to your project, it's helpful to have some documentation on how to get started. Perhaps there is a script that they should run or some environment variables that they need to set. Make these steps explicit. These instructions could also be useful to your future self.

You can also document commands to lint the code or run tests. These steps help to ensure high code quality and reduce the likelihood that the changes inadvertently break something. Having instructions for running tests is especially helpful if it requires external setup, such as starting a Selenium server for testing in a browser.

## Authors and acknowledgment
Show your appreciation to those who have contributed to the project.

## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.
=======
# API Documentation

## I. Auth APIs

### 1. Login
POST /api/v1/auth/login
Request: {
    telegram_id: string,
    signature: string,
    wallet_address: string
}
Response: {
    status: 200 | 401 | 500,
    message: string | null,
    token: string
}

### 2. Verify Token
GET /api/v1/auth/verify
Headers: {
    "Authorization": "Bearer {token}"
}
Response: {
    status: 200 | 401,
    message: string,
    data: {
        valid: boolean,
        user?: {
            id: number,
            telegram_id: string
        }
    }
}

******************************************

## II. Trade APIs

### 1. Create Order
POST /api/v1/trade/order
Headers: {
    "Authorization": "Bearer {token}"
}
Request: {
    order_token_address: string,
    order_qlty: number,
    order_price: number,
    order_trade_type: "buy" | "sell",
    order_type: "market" | "limit"
}
Response: {
    status: 201 | 400 | 500,
    message: string,
    data: {
        order_id: number,
        wallet_id: number,
        trade_type: string,
        token: {
            address: string,
            name: string
        },
        quantity: number,
        price: number,
        total_value: number,
        status: string,
        created_at: string
    } | null
}

### 2. Get Orders
GET /api/v1/trade/orders
Headers: {
    "Authorization": "Bearer {token}"
}
Query params: {
    status?: "pending" | "completed" | "cancelled",
    type?: "buy" | "sell",
    from_date?: string,
    to_date?: string
}
Response: {
    status: 200 | 500,
    message: string,
    data: Array<{
        order_id: number,
        order_type: string,
        order_status: string,
        order_price: number,
        order_quantity: number,
        created_at: string
    }> | null
}

### 3. Cancel Order
POST /api/v1/trade/orders/:orderId/cancel
Headers: {
    "Authorization": "Bearer {token}"
}
Response: {
    status: 200 | 404 | 500,
    message: string,
    data: {
        order_id: number,
        status: string,
        cancelled_at: string
    } | null
}

### 4. Get Order Book
GET /api/v1/trade/order-book
Headers: {
    "Authorization": "Bearer {token}"
}
Query params: {
    token_address: string,
    depth?: number,
    min_quantity?: number
}
Response: {
    status: 200 | 500,
    message: string,
    data: {
        bids: Array<{
            price: number,
            quantity: number,
            total: number
        }>,
        asks: Array<{
            price: number,
            quantity: number,
            total: number
        }>,
        spread: number,
        last_price: number
    } | null
}

******************************************

## III. Copy Trade APIs

// 1. Create Copy Trade
POST /api/v1/copy-trade
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  tracking_wallet: string,
  amount: number,
  buy_option: "maxbuy" | "fixedbuy" | "fixedratio",
  fixed_ratio?: number,
  sell_method: "auto" | "notsell" | "manual",
  tp?: number,
  sl_value?: number
}
Response: {
  status: 201 | 400 | 500,
  message: string,
  data: {
    ct_id: number,
    ct_tracking_wallet: string,
    ct_amount: number,
    // ... other copy trade details
  } | null
}

// 2. Get Copy Trades List
GET /api/v1/copy-trade
Headers: {
  "Authorization": "Bearer {token}"
}
Response: {
  status: 200 | 500,
  message?: string,
  data: Array<{
    ct_id: number,
    ct_tracking_wallet: string,
    // ... other trade details
  }>
}

// 3. Change Copy Trade Status
POST /api/v1/copy-trade/change-status
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  ct_id: number,
  status: "running" | "pause" | "stop"
}
Response: {
  status: 200 | 400 | 404 | 500,
  message: string,
  data: {
    ct_id: number,
    ct_status: string,
    // ... updated trade details
  } | null
}

// 4. Get Copy Trade Details
GET /api/v1/copy-trade/details/:ct_id
Headers: {
  "Authorization": "Bearer {token}"
}
Query params: {
  status?: "failed" | "success"
}
Response: {
  status: 200 | 404 | 500,
  message?: string,
  data: Array<{
    ct_detail_id: number,
    ct_detail_type: string,
    // ... transaction details
  }> | null
}

// 5. Change Copy Trade Name
POST /api/v1/copy-trade/change-name
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  ct_id: number,
  tracking_name: string
}
Response: {
  status: 200 | 404 | 500,
  message: string,
  data: {
    ct_id: number,
    ct_tracking_name: string,
    // ... updated trade details
  } | null
}

// 6. Get Positions
GET /api/v1/copy-trade/positions
Headers: {
  "Authorization": "Bearer {token}"
}
Response: {
  status: 200 | 404 | 500,
  message: string,
  data: {
    total_positions: number,
    open_positions: number,
    positions: Array<{
      position_id: number,
      token_address: string,
      entry_price: number,
      current_price: number | null,
      amount: number,
      pnl: number | null,
      pnl_percent: number | null,
      status: string,
      // ... other position details
    }>
  } | null
}

******************************************

## IV. Master Trading APIs

// 1. Create Master Group
POST /api/v1/master-trading/group
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  mg_name: string,
  mg_option: string,
  mg_fixed_price?: number,
  mg_fixed_ratio?: number
}
Response: {
  status: 201 | 403 | 500,
  message: string,
  data: {
    mg_id: number,
    mg_name: string,
    // ... group details
  } | null
}

// 2. Authorize Group
POST /api/v1/master-trading/auth
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  mga_group_id: number,
  mga_wallet_member: number
}
Response: {
  status: 200 | 403 | 500,
  message: string,
  data: {
    mga_id: number,
    // ... auth details
  } | null
}

// 3. Get Master Groups
GET /api/v1/master-trading/groups
Headers: {
  "Authorization": "Bearer {token}"
}
Response: {
  status: 200 | 500,
  message?: string,
  data: Array<{
    mg_id: number,
    mg_name: string,
    // ... group details
  }>
}

// 4. Create Master Transaction
POST /api/v1/master-trading/transaction
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  mt_group_list: number[],
  mt_token_name: string,
  mt_token_address: string,
  mt_type: "buy" | "sell",
  mt_price: number
}
Response: {
  status: 201 | 403 | 400 | 500,
  message: string,
  data: {
    mt_id: number,
    // ... transaction details
  } | null
}

// 5. Get Master Transactions
GET /api/v1/master-trading/transactions
Headers: {
  "Authorization": "Bearer {token}"
}
Query params: {
  status?: "running" | "pause" | "stop"
}
Response: {
  status: 200 | 500,
  message?: string,
  data: Array<{
    mt_id: number,
    // ... transaction details
  }>
}

// 6. Change Transaction Status
POST /api/v1/master-trading/transaction/:mt_id/status
Headers: {
  "Authorization": "Bearer {token}"
}
Request: {
  status: "running" | "pause" | "stop"
}
Response: {
  status: 200 | 404 | 500,
  message: string,
  data: {
    mt_id: number,
    mt_status: string,
    // ... updated details
  } | null
}

// 7. Get Transaction History
GET /api/v1/master-trading/transactions/history
Headers: {
  "Authorization": "Bearer {token}"
}
Query params: {
  from_date?: string,
  to_date?: string
}
Response: {
  status: 200 | 500,
  message?: string,
  data: Array<{
    mt_detail_id: number,
    // ... transaction history details
  }>
}

// 8. Get Transaction Stats
GET /api/v1/master-trading/transactions/stats
Headers: {
  "Authorization": "Bearer {token}"
}
Query params: {
  from_date?: string,
  to_date?: string
}
Response: {
  status: 200 | 500,
  message?: string,
  data: {
    total_transactions: number,
    successful_transactions: number,
    total_volume: number,
    average_price: number,
    success_rate: number
  } | null
}

// 9. Get Group Members
GET /api/v1/master-trading/groups/members
Headers: {
  "Authorization": "Bearer {token}"
}
Query params: {
  groupId: number
}
Response: {
  status: 200 | 500,
  message?: string,
  data: Array<{
    member_id: number,
    member_address: string,
    status: string
  }> | null
}

******************************************

## V. Solana APIs

### 1. Get Token Price
GET /api/v1/solana/price
Headers: {
    "Authorization": "Bearer {token}"
}
Query params: {
    token_address: string
}
Response: {
    status: 200 | 500,
    message: string,
    data: {
        price: number,
        timestamp: number
    } | null
}

### 2. Get Price History
GET /api/v1/solana/price-history
Headers: {
    "Authorization": "Bearer {token}"
}
Query params: {
    token_address: string,
    interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d",
    from_time?: number,
    to_time?: number
}
Response: {
    status: 200 | 500,
    message: string,
    data: Array<{
        price: number,
        timestamp: number
    }> | null
}

### 3. Smart Route Swap
POST /api/v1/solana/smart-swap
Headers: {
    "Authorization": "Bearer {token}"
}
Request: {
    input_mint: string,
    output_mint: string,
    amount: number,
    slippage: number
}
Response: {
    status: 200 | 400 | 500,
    message: string,
    data: {
        txId: string,
        route: string,
        executedPrice: number
    } | null
}

******************************************

## VI. Telegram Wallet APIs

### 1. Connect Wallet
POST /api/v1/telegram-wallets/connect
Headers: {
    "Authorization": "Bearer {token}"
}
Request: {
    telegram_id: string,
    wallet_address: string,
    signature: string
}
Response: {
    status: 201 | 400 | 500,
    message: string,
    data: {
        wallet_id: number,
        telegram_id: string,
        wallet_address: string,
        created_at: string
    } | null
}

### 2. Get Connected Wallets
GET /api/v1/telegram-wallets
Headers: {
    "Authorization": "Bearer {token}"
}
Response: {
    status: 200 | 500,
    message: string,
    data: Array<{
        wallet_id: number,
        wallet_address: string,
        balance: number,
        created_at: string
    }> | null
}

### 3. Disconnect Wallet
POST /api/v1/telegram-wallets/disconnect
Headers: {
    "Authorization": "Bearer {token}"
}
Request: {
    wallet_id: number
}
Response: {
    status: 200 | 404 | 500,
    message: string,
    data: {
        wallet_id: number,
        disconnected_at: string
    } | null
}
>>>>>>> test
